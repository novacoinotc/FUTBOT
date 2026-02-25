"""Local order book tracking (top levels from bookTicker)."""

import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional


@dataclass
class BookLevel:
    bid_price: float
    bid_qty: float
    ask_price: float
    ask_qty: float
    update_time: float  # seconds


class OrderBookStore:
    """Stores best bid/ask for each pair from bookTicker stream."""

    def __init__(self):
        self._books: dict[str, BookLevel] = {}

    def update_from_book_ticker(self, data: dict):
        """Update from Binance bookTicker message."""
        pair = data["s"]
        self._books[pair] = BookLevel(
            bid_price=float(data["b"]),
            bid_qty=float(data["B"]),
            ask_price=float(data["a"]),
            ask_qty=float(data["A"]),
            update_time=time.time(),
        )

    def get(self, pair: str) -> Optional[BookLevel]:
        return self._books.get(pair)

    def get_spread(self, pair: str) -> Optional[float]:
        """Get bid-ask spread as percentage."""
        book = self._books.get(pair)
        if not book or book.bid_price == 0:
            return None
        return (book.ask_price - book.bid_price) / book.bid_price

    def get_imbalance(self, pair: str) -> Optional[float]:
        """Get order book imbalance (bid_qty / ask_qty). >1 = more buyers."""
        book = self._books.get(pair)
        if not book or book.ask_qty == 0:
            return None
        return book.bid_qty / book.ask_qty

    def get_mid_price(self, pair: str) -> Optional[float]:
        """Get mid-market price."""
        book = self._books.get(pair)
        if not book:
            return None
        return (book.bid_price + book.ask_price) / 2

    def is_stale(self, pair: str, max_age_seconds: float = 5.0) -> bool:
        """Check if book data is stale."""
        book = self._books.get(pair)
        if not book:
            return True
        return (time.time() - book.update_time) > max_age_seconds
