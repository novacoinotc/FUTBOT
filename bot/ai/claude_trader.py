"""Claude as the trader: analyzes market data, makes trade decisions."""

import json
import logging
from datetime import datetime
from typing import Optional

import anthropic

from config.settings import settings
from core.models import (
    ActionType,
    Direction,
    MarketSnapshot,
    TradeDecision,
    ApiCost,
)
from db.database import Database

logger = logging.getLogger(__name__)

# Cost per 1M tokens (approximate)
HAIKU_INPUT_COST = 1.00   # $1/MTok
HAIKU_OUTPUT_COST = 5.00  # $5/MTok
SONNET_INPUT_COST = 3.00  # $3/MTok
SONNET_OUTPUT_COST = 15.00  # $15/MTok

TRADE_DECISION_SYSTEM = """You are an elite Binance Futures scalping AI running 24/7. You are aggressive and decisive.
Your goal: maximize net PnL after ALL costs (fees, funding, slippage, API).

YOU ARE A SCALPER:
- Target 0.5-2% moves per trade
- ENTER when 2-3 indicators align, even if not all are perfect
- Be SELECTIVE: quality entries > quantity. Only enter with clear technical edge.

CRITICAL: GIVE TRADES ROOM TO BREATHE
- SL too tight = guaranteed stop-out from normal market noise
- SL MINIMUM 1.5x ATR from entry, prefer 2-2.5x ATR
- TP MINIMUM 2x ATR, prefer 3-4x ATR for 1.5:1+ R:R
- For BTC/ETH: SL at least $50-150 / $3-10 from entry
- For altcoins: SL at least 0.5-1.5% from entry
- NEVER set SL closer than 0.4% from entry on any pair

AUTONOMY:
- Choose which indicators matter (don't need all of them)
- Strategy: momentum, mean-reversion, breakout, trend-following, or hybrid
- Leverage (2-8x), position size (0.3-1%), SL/TP distances

INDICATORS IN DATA:
1m: RSI(7/14), StochRSI(K/D), EMA Alignment(-1/+1), MACD(hist+signal), BB(pct/width/squeeze), ADX+DI+/DI-, MFI, ATR%, VWAP, Volume Delta
5m: RSI_14, EMA_trend, ADX, MACD_signal
Advanced: RSI Divergence, Consecutive Candles(+N/-N), Price Position(0-1), Volume Buy Ratio(0-1)
Volume: volume_ratio (current/avg, >1.5=spike confirming move, <0.7=low conviction)
Support/Resistance: dist_to_support_pct, dist_to_resistance_pct (% from nearest swing levels)
Price Stretch: price_ema_ratio (price/EMA21, <0.98=oversold stretch, >1.02=overbought stretch)
Composites: momentum_score(0-1), trend_strength_score(0-1) — pre-computed signal quality
Order Flow: Book Imbalance(>1=buyers), Spread%
Futures: Funding Rate, Open Interest + OI Change%, Long/Short Ratio (top traders)
Macro: Fear&Greed Index (0=extreme fear, 100=extreme greed)

USE THE MARKET REGIME:
- You will receive the overall market regime (trending_up/trending_down/ranging/volatile)
- trending_up: favor LONGs, use trend-following, wider TP
- trending_down: favor SHORTs, use trend-following, wider TP
- ranging: mean-reversion, fade extremes, tighter SL/TP
- volatile: wider SL (2.5x ATR), reduce position size, only highest-conviction setups

STRATEGY BY INDICATORS:
- ADX>25 + EMA aligned → TREND FOLLOW (wider SL 2-2.5x ATR, wider TP)
- ADX<20 + BB squeeze → MEAN REVERT (fade extremes)
- BB squeeze releasing + volume → BREAKOUT (enter on confirmation)
- RSI divergence → REVERSAL (counter-trend)
- Consecutive 4+ candles → EXHAUSTION (fade it)
- Book imbalance >2 or <0.5 → Strong directional pressure

FEAR & GREED: Do NOT stop trading in fear markets. Volatility = opportunity.
- Extreme Fear (<20): More SHORT opportunities, watch for bounce LONGs. Use 2x ATR SL.
- Moderate: Standard approach
- Extreme Greed (>80): Watch for reversals, favor SHORTs

PAST PERFORMANCE NOTE:
- Win-rate stats may be based on small samples — treat them as hints, not rules
- NEVER refuse to trade a pair just because of a small-sample bad streak
- Focus on the CURRENT technical setup, not historical anecdotes

POSITION MANAGEMENT (CRITICAL):
- LET TRADES WORK. SL and TP exist for a reason — don't manually EXIT before they trigger.
- EXIT only if: (1) MAJOR reversal signal (not minor fluctuation), OR (2) position in profit ≥ 1%
- Small drawdowns (-0.5%) are NORMAL in scalping. Do NOT panic-exit every dip.
- If position is profitable, PREFER ADJUST (tighten SL to lock profit) over EXIT.
- HOLD is often the best decision for open positions. Patience wins.

HARD RULES:
- EXACTLY ONE JSON object (no markdown, no text outside JSON)
- Confidence 0.0-1.0; trade when >= 0.65
- Max {max_positions} positions, max 1 per pair
- BOTH stop_loss AND take_profit MANDATORY
- Risk per trade: max {risk_pct}% of capital

RESPONSE:
{{
  "action": "ENTER_LONG" | "ENTER_SHORT" | "EXIT" | "ADJUST" | "HOLD",
  "pair": "BTCUSDT",
  "direction": "LONG" | "SHORT",
  "leverage": 3,
  "position_size_pct": 0.005,
  "stop_loss": 97000.0,
  "take_profit": 98500.0,
  "trailing_stop": true,
  "reasoning": "Specific indicators that drove this decision",
  "confidence": 0.75
}}

For HOLD: {{"action": "HOLD", "pair": "BTCUSDT", "reasoning": "No setup", "confidence": 0.0}}
For EXIT: {{"action": "EXIT", "pair": "BTCUSDT", "reasoning": "...", "confidence": 0.8}}
For ADJUST: {{"action": "ADJUST", "pair": "BTCUSDT", "stop_loss": 97500, "take_profit": 98500, "reasoning": "...", "confidence": 0.7}}
"""

DEEP_ANALYSIS_SYSTEM = """You are a senior quantitative trader doing a deep market review.
Analyze the provided trading data and provide actionable intelligence.

Focus on:
1. **Market Regime**: trending_up, trending_down, ranging, or volatile (with confidence)
2. **Trade Reviews**: For each trade, what went RIGHT and what went WRONG. Be specific.
3. **Pattern Discovery**: Look for winning patterns - specific indicator combinations that work
4. **Rule Proposals**: Concrete, testable rules (e.g., "LONG when RSI<30 AND ADX>25 AND EMA_alignment>0")
5. **Parameter Tuning**: Based on win rate and hold times, suggest parameter changes
6. **Strategy Assessment**: Which strategies are working? Which should be abandoned?

Respond as JSON:
{{
  "market_regime": "trending_up",
  "trade_reviews": [
    {{"trade_id": "abc123", "assessment": "good/bad", "lesson_learned": "...", "tags": ["momentum", "reversal"]}}
  ],
  "proposed_rules": [
    {{"rule": "Avoid LONG when RSI_14 > 75 and MACD bearish_cross", "confidence": 0.7}}
  ],
  "parameter_suggestions": [
    {{"param": "default_leverage", "current": 3, "suggested": 4, "reasoning": "..."}}
  ],
  "strategies_working": ["trend_following on BTC/ETH"],
  "strategies_failing": ["mean_reversion on altcoins in trending market"],
  "overall_assessment": "Brief summary of market conditions and bot performance"
}}
"""


class ClaudeTrader:
    """Uses Claude to make trade decisions and perform deep analysis."""

    def __init__(self, db: Database):
        self.client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self.db = db

    async def make_decision(
        self,
        snapshot: MarketSnapshot,
        open_positions: list[dict],
        similar_trades: list[dict],
        active_rules: list[dict],
        current_params: dict,
        balance: float,
        pattern_stats: dict = None,
        market_regime: str = "unknown",
        market_context: dict = None,
    ) -> TradeDecision:
        """Ask Claude Haiku to make a trade decision for a single pair."""

        # Build compact prompt
        has_position = any(p["pair"] == snapshot.pair for p in open_positions)

        user_prompt = self._build_trade_prompt(
            snapshot, open_positions, similar_trades, active_rules,
            current_params, balance, has_position, pattern_stats,
            market_regime, market_context,
        )

        system = TRADE_DECISION_SYSTEM.format(
            max_positions=int(current_params.get("max_open_positions", settings.max_open_positions)),
            risk_pct=current_params.get("max_risk_per_trade_pct", settings.max_risk_per_trade_pct) * 100,
        )

        try:
            response = self.client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=450,
                system=system,
                messages=[{"role": "user", "content": user_prompt}],
            )

            # Track cost
            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens
            cost = (input_tokens / 1_000_000 * HAIKU_INPUT_COST) + (output_tokens / 1_000_000 * HAIKU_OUTPUT_COST)

            await self.db.insert_api_cost({
                "service": "claude_haiku",
                "tokens_in": input_tokens,
                "tokens_out": output_tokens,
                "cost_usd": round(cost, 6),
                "purpose": "trade_decision",
                "created_at": datetime.utcnow().isoformat(),
            })

            # Parse response
            text = response.content[0].text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            decision_data = json.loads(text)
            decision = TradeDecision(
                action=ActionType(decision_data["action"]),
                pair=decision_data.get("pair", snapshot.pair),
                direction=Direction(decision_data["direction"]) if decision_data.get("direction") else None,
                leverage=decision_data.get("leverage"),
                position_size_pct=decision_data.get("position_size_pct"),
                entry_price=decision_data.get("entry_price") or snapshot.price,
                stop_loss=decision_data.get("stop_loss"),
                take_profit=decision_data.get("take_profit"),
                reasoning=decision_data.get("reasoning", ""),
                confidence=decision_data.get("confidence", 0.0),
            )

            logger.info(
                f"[{snapshot.pair}] Claude: {decision.action.value} "
                f"conf={decision.confidence:.2f} - {decision.reasoning[:80]}"
            )
            return decision

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Claude response: {e}")
            return TradeDecision(action=ActionType.HOLD, pair=snapshot.pair, reasoning=f"Parse error: {e}")
        except Exception as e:
            logger.error(f"Claude API error: {e}")
            return TradeDecision(action=ActionType.HOLD, pair=snapshot.pair, reasoning=f"API error: {e}")

    async def deep_analysis(
        self,
        recent_trades: list[dict],
        current_params: dict,
        market_summary: dict,
        memories: list[dict],
    ) -> dict:
        """Use Claude Sonnet for deep analysis: trade reviews, regime detection, optimization."""

        user_prompt = f"""## Deep Market Analysis Request

### Market Summary
{json.dumps(market_summary, indent=2)}

### Current Parameters
{json.dumps(current_params, indent=2)}

### Recent Trades (last period)
{json.dumps(recent_trades[:50], indent=2, default=str)}

### Recent Memory/Lessons
{json.dumps(memories[:15], indent=2, default=str)}

Analyze deeply:
1. Current market regime (with evidence)
2. Review each trade - what patterns worked/failed?
3. Propose concrete, testable rules with indicator thresholds
4. Which strategies work in current conditions?
5. Parameter adjustments if needed
"""

        try:
            response = self.client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=4000,
                system=DEEP_ANALYSIS_SYSTEM,
                messages=[{"role": "user", "content": user_prompt}],
            )

            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens
            cost = (input_tokens / 1_000_000 * SONNET_INPUT_COST) + (output_tokens / 1_000_000 * SONNET_OUTPUT_COST)

            await self.db.insert_api_cost({
                "service": "claude_sonnet",
                "tokens_in": input_tokens,
                "tokens_out": output_tokens,
                "cost_usd": round(cost, 6),
                "purpose": "deep_analysis",
                "created_at": datetime.utcnow().isoformat(),
            })

            text = response.content[0].text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            return json.loads(text)

        except Exception as e:
            logger.error(f"Deep analysis error: {e}")
            return {"error": str(e)}

    def _build_trade_prompt(
        self,
        snapshot: MarketSnapshot,
        open_positions: list[dict],
        similar_trades: list[dict],
        active_rules: list[dict],
        current_params: dict,
        balance: float,
        has_position: bool,
        pattern_stats: dict = None,
        market_regime: str = "unknown",
        market_context: dict = None,
    ) -> str:
        """Build compact but comprehensive prompt for trade decision."""
        # Only include non-None fields, exclude noisy ones
        snap_dict = snapshot.model_dump(exclude_none=True)
        snap_dict["timestamp"] = snap_dict["timestamp"].isoformat()
        # Remove fields that Claude doesn't need raw (ema_alignment covers these)
        for key in ("ema_9", "ema_21", "ema_50", "bb_upper", "bb_lower"):
            snap_dict.pop(key, None)
        # Remove useless sentiment if CryptoPanic is disabled
        if snap_dict.get("sentiment") and "unavailable" in str(snap_dict.get("sentiment", {}).get("recent_news", "")):
            snap_dict.pop("sentiment", None)

        # Market regime and broader context FIRST so Claude has full picture
        regime_line = f"**Regime: {market_regime}**"
        if market_context:
            bull = market_context.get("bullish_pairs", 0)
            bear = market_context.get("bearish_pairs", 0)
            total = market_context.get("total_pairs", 0)
            fg = market_context.get("fear_greed", "?")
            regime_line += f" | Market: {bull}/{total} bullish, {bear}/{total} bearish | F&G: {fg}"

        parts = [
            f"## Market Overview\n{regime_line}",
            f"\n## {snapshot.pair} Data\n{json.dumps(snap_dict, indent=2)}",
            f"\n## Account\nBalance: ${balance:.2f} | Open: {len(open_positions)}/{int(current_params.get('max_open_positions', 5))}",
        ]

        if has_position:
            pos = next(p for p in open_positions if p["pair"] == snapshot.pair)
            parts.append(f"\n## Current Position\n{json.dumps(pos, indent=2)}")

        if open_positions:
            other = [p for p in open_positions if p["pair"] != snapshot.pair]
            if other:
                summary = [{"pair": p["pair"], "dir": p["direction"], "pnl": p["unrealized_pnl"]} for p in other]
                parts.append(f"\n## Other Positions\n{json.dumps(summary)}")

        # Win-rate statistics (only if meaningful sample size)
        if pattern_stats and pattern_stats.get("total", 0) >= 8:
            parts.append(f"\n## Win Rate for {snapshot.pair} (sample={pattern_stats['total']})\n{pattern_stats['summary']}")

        # Similar trades with lessons (only include trades that have actual lessons)
        if similar_trades:
            lessons = []
            for t in similar_trades[:5]:
                lesson = t.get("lesson_learned", "")
                if lesson:  # only include if there's an actual lesson
                    lessons.append({
                        "dir": t["direction"],
                        "pnl%": t.get("pnl_pct", 0),
                        "lesson": lesson[:100],
                        "regime": t["market_regime"],
                    })
            if lessons:
                parts.append(f"\n## Past Lessons on {snapshot.pair}\n{json.dumps(lessons)}")

        # Active rules (only effective ones)
        if active_rules:
            rules_with_stats = []
            for r in active_rules[:7]:
                applied = r.get("times_applied", 0)
                success = r.get("times_successful", 0)
                rate = f" ({success}/{applied}={success/applied*100:.0f}%)" if applied > 0 else " (new)"
                rules_with_stats.append(f"- {r['rule']}{rate}")
            parts.append(f"\n## Learned Rules\n" + "\n".join(rules_with_stats))

        # Task
        if has_position:
            pos = next(p for p in open_positions if p["pair"] == snapshot.pair)
            hold_min = pos.get("hold_time_minutes", 0)
            pnl_pct = pos.get("unrealized_pnl", 0) / max(pos.get("margin_used", 1), 1) * 100
            parts.append(
                f"\n## Task\nDecide: EXIT, ADJUST, or HOLD. Position held {hold_min:.0f} min, PnL: {pnl_pct:.1f}%."
                " PREFER HOLD — let SL/TP do their job."
                " EXIT only for MAJOR reversal signals (not minor fluctuations)."
                " If profitable: ADJUST SL to lock profit rather than EXIT."
            )
        else:
            parts.append(
                f"\n## Task\nDecide: ENTER_LONG, ENTER_SHORT, or HOLD for {snapshot.pair}."
                " If entering: set SL at 1.5-2.5x ATR (min 0.5% from entry), TP at 2-4x ATR."
                " Only enter with CLEAR technical edge. Quality > quantity."
            )

        return "\n".join(parts)
