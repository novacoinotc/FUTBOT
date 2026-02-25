"""Auto-optimizer: adjusts bot parameters based on performance using Claude Sonnet."""

import json
import logging
from datetime import datetime
from typing import Optional

import anthropic

from config.settings import settings
from db.database import Database

logger = logging.getLogger(__name__)

OPTIMIZER_SYSTEM = """You are a quantitative trading system optimizer.
Given recent performance data, suggest parameter adjustments.

CONSTRAINTS:
- Each parameter can change by max 20% per optimization cycle
- Leverage: 1-10x
- Position size: 0.2%-1.5% of capital
- Max open positions: 1-8
- Min score to enter: 0.4-0.9
- Stay conservative with changes

Respond with ONLY JSON:
{{
  "changes": [
    {{
      "param_name": "default_leverage",
      "current_value": 3,
      "new_value": 4,
      "reasoning": "Win rate above 60% with consistent profits justifies higher leverage"
    }}
  ],
  "overall_reasoning": "Brief summary of why these changes"
}}

If no changes needed: {{"changes": [], "overall_reasoning": "Performance is stable, no adjustments needed"}}
"""

# Parameter bounds
PARAM_BOUNDS = {
    "default_leverage": (2, 10),
    "default_position_pct": (0.003, 0.015),
    "max_open_positions": (3, 8),
    "min_score_to_enter": (0.50, 0.70),  # scalping needs lower entry bar
    "daily_loss_pause_pct": (-0.05, -0.01),
}

MAX_CHANGE_PCT = 0.20  # 20% max change per cycle


class Optimizer:
    """Auto-optimizes bot parameters every 6 hours based on performance."""

    def __init__(self, db: Database):
        self.client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self.db = db
        self._last_run: Optional[datetime] = None

    async def initialize(self):
        """Set initial parameters in DB if not present."""
        current = await self.db.get_current_params()
        defaults = {
            "default_leverage": settings.default_leverage,
            "default_position_pct": settings.default_position_pct,
            "max_open_positions": settings.max_open_positions,
            "min_score_to_enter": settings.min_score_to_enter,
        }
        for name, value in defaults.items():
            if name not in current:
                await self.db.set_current_param(name, value)

    async def should_run(self) -> bool:
        """Check if enough time has passed since last optimization."""
        if self._last_run is None:
            return True
        elapsed = (datetime.utcnow() - self._last_run).total_seconds() / 3600
        return elapsed >= settings.optimization_interval_hours

    async def run(self, performance: dict, recent_trades: list[dict]) -> list[dict]:
        """Run optimization cycle. Returns list of applied changes."""
        self._last_run = datetime.utcnow()
        current_params = await self.db.get_current_params()

        if not recent_trades:
            logger.info("No trades to optimize on, skipping")
            return []

        # Build prompt
        prompt = f"""## Optimization Request

### Current Parameters
{json.dumps(current_params, indent=2)}

### Performance (last period)
{json.dumps(performance, indent=2)}

### Recent Trades Summary
Total: {len(recent_trades)}
Winning: {sum(1 for t in recent_trades if t.get('pnl', 0) > 0)}
Losing: {sum(1 for t in recent_trades if t.get('pnl', 0) <= 0)}
Total PnL: {sum(t.get('pnl', 0) for t in recent_trades):.4f}
Avg PnL: {sum(t.get('pnl', 0) for t in recent_trades) / max(len(recent_trades), 1):.4f}

### Trade Details (last 20)
{json.dumps(recent_trades[:20], indent=2, default=str)}

Suggest parameter changes (max 20% change per parameter per cycle).
"""

        try:
            response = self.client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=1000,
                system=OPTIMIZER_SYSTEM,
                messages=[{"role": "user", "content": prompt}],
            )

            # Track cost
            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens
            cost = (input_tokens / 1_000_000 * 3.0) + (output_tokens / 1_000_000 * 15.0)
            await self.db.insert_api_cost({
                "service": "claude_sonnet",
                "tokens_in": input_tokens,
                "tokens_out": output_tokens,
                "cost_usd": round(cost, 6),
                "purpose": "optimization",
                "created_at": datetime.utcnow().isoformat(),
            })

            text = response.content[0].text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            result = json.loads(text)
            changes = result.get("changes", [])

            applied = []
            for change in changes:
                name = change["param_name"]
                new_val = change["new_value"]
                current_val = current_params.get(name, change.get("current_value"))

                if current_val is None:
                    continue

                # Enforce max 20% change
                if current_val != 0:
                    change_pct = abs(new_val - current_val) / abs(current_val)
                    if change_pct > MAX_CHANGE_PCT:
                        direction = 1 if new_val > current_val else -1
                        new_val = current_val * (1 + direction * MAX_CHANGE_PCT)

                # Enforce bounds
                if name in PARAM_BOUNDS:
                    lo, hi = PARAM_BOUNDS[name]
                    new_val = max(lo, min(hi, new_val))

                # Round appropriately
                if name in ("default_leverage", "max_open_positions"):
                    new_val = int(round(new_val))
                else:
                    new_val = round(new_val, 4)

                # Apply
                await self.db.set_current_param(name, new_val)
                await self.db.insert_param_change({
                    "param_name": name,
                    "old_value": current_val,
                    "new_value": new_val,
                    "reasoning": change.get("reasoning", ""),
                    "performance_before": json.dumps(performance),
                    "created_at": datetime.utcnow().isoformat(),
                })

                applied.append({
                    "param": name,
                    "old": current_val,
                    "new": new_val,
                    "reasoning": change.get("reasoning", ""),
                })
                logger.info(f"Optimizer: {name} {current_val} → {new_val}: {change.get('reasoning', '')[:60]}")

            logger.info(f"Optimization complete: {len(applied)} parameters changed")
            return applied

        except Exception as e:
            logger.error(f"Optimization error: {e}")
            return []

    async def revert_last_changes(self):
        """Revert the last batch of parameter changes if performance worsened."""
        history = await self.db.get_param_history(limit=10)
        for change in history:
            if not change.get("reverted"):
                name = change["param_name"]
                old_val = change["old_value"]
                await self.db.set_current_param(name, old_val)
                await self.db.insert_param_change({
                    "param_name": name,
                    "old_value": change["new_value"],
                    "new_value": old_val,
                    "reasoning": "Reverted: performance worsened after change",
                    "reverted": 1,
                    "created_at": datetime.utcnow().isoformat(),
                })
                logger.info(f"Reverted {name} back to {old_val}")
