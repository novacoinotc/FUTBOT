"""Live trader for Binance Futures (placeholder for future use)."""

import logging

logger = logging.getLogger(__name__)


class LiveTrader:
    """Placeholder for real Binance Futures execution.

    Will be implemented when paper trading proves consistently profitable.
    Must pass the same interface as PaperTrader.
    """

    def __init__(self):
        raise NotImplementedError(
            "Live trading is not yet implemented. "
            "Paper trading must be profitable first."
        )
