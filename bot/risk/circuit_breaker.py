"""Circuit breaker: automatic trading halt on excessive losses."""

import logging
from datetime import datetime, timedelta
from typing import Optional

from config.settings import settings

logger = logging.getLogger(__name__)


class CircuitBreaker:
    """Kill switch for excessive losses. Cannot be overridden by Claude."""

    def __init__(self):
        self._daily_start_equity: float = 0
        self._initial_equity: float = 0
        self._paused_until: Optional[datetime] = None
        self._stopped_for_day: bool = False
        self._full_stop: bool = False
        self._today: Optional[str] = None

    def initialize(self, equity: float):
        """Set initial equity levels."""
        self._initial_equity = equity
        self._daily_start_equity = equity
        self._today = datetime.utcnow().strftime("%Y-%m-%d")

    def check_new_day(self, equity: float):
        """Reset daily tracking on new day."""
        today = datetime.utcnow().strftime("%Y-%m-%d")
        if today != self._today:
            self._today = today
            self._daily_start_equity = equity
            self._stopped_for_day = False
            self._paused_until = None
            logger.info(f"Circuit breaker: new day, daily start equity = ${equity:.2f}")

    def check(self, current_equity: float) -> tuple[bool, str]:
        """Check if trading should be halted.
        Returns (is_active, reason).
        """
        now = datetime.utcnow()

        # Full stop check (total drawdown)
        if self._full_stop:
            return True, "FULL STOP: Total drawdown exceeded -10%. Manual review required."

        # Stopped for day
        if self._stopped_for_day:
            return True, f"Day stopped: daily loss exceeded {settings.daily_loss_stop_pct*100:.1f}%"

        # Paused (temporary)
        if self._paused_until and now < self._paused_until:
            remaining = (self._paused_until - now).total_seconds() / 60
            return True, f"Paused for {remaining:.0f} more minutes (daily loss hit {settings.daily_loss_pause_pct*100:.1f}%)"

        if self._paused_until and now >= self._paused_until:
            self._paused_until = None
            logger.info("Circuit breaker: pause period ended, resuming trading")

        # Check total drawdown
        if self._initial_equity > 0:
            total_dd = (current_equity - self._initial_equity) / self._initial_equity
            if total_dd <= settings.total_drawdown_stop_pct:
                self._full_stop = True
                logger.critical(
                    f"CIRCUIT BREAKER: Full stop! Total drawdown {total_dd:.2%} "
                    f"(equity: ${current_equity:.2f}, initial: ${self._initial_equity:.2f})"
                )
                return True, f"FULL STOP: Drawdown {total_dd:.2%} exceeded limit"

        # Check daily loss
        if self._daily_start_equity > 0:
            daily_dd = (current_equity - self._daily_start_equity) / self._daily_start_equity

            # -3% → stop for day
            if daily_dd <= settings.daily_loss_stop_pct:
                self._stopped_for_day = True
                logger.warning(
                    f"CIRCUIT BREAKER: Day stopped! Daily loss {daily_dd:.2%} "
                    f"(equity: ${current_equity:.2f}, day start: ${self._daily_start_equity:.2f})"
                )
                return True, f"Day stopped: daily loss {daily_dd:.2%}"

            # -2% → pause 4 hours
            if daily_dd <= settings.daily_loss_pause_pct and self._paused_until is None:
                self._paused_until = now + timedelta(hours=4)
                logger.warning(
                    f"CIRCUIT BREAKER: Paused 4h! Daily loss {daily_dd:.2%} "
                    f"(equity: ${current_equity:.2f})"
                )
                return True, f"Paused 4h: daily loss {daily_dd:.2%}"

        return False, ""

    @property
    def is_active(self) -> bool:
        """Quick check if circuit breaker is active."""
        active, _ = self.check(self._daily_start_equity)  # approximate
        return active

    @property
    def status(self) -> dict:
        return {
            "full_stop": self._full_stop,
            "stopped_for_day": self._stopped_for_day,
            "paused_until": self._paused_until.isoformat() if self._paused_until else None,
            "daily_start_equity": self._daily_start_equity,
            "initial_equity": self._initial_equity,
        }

    def reset_full_stop(self):
        """Manual reset of full stop (requires human review)."""
        self._full_stop = False
        logger.info("Circuit breaker: full stop manually reset")
