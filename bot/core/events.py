"""Internal event bus using asyncio.Queue for decoupled communication."""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)


class EventType(str, Enum):
    KLINE_UPDATE = "kline_update"
    KLINE_CLOSED = "kline_closed"
    BOOK_UPDATE = "book_update"
    AGG_TRADE = "agg_trade"
    SIGNAL_GENERATED = "signal_generated"
    TRADE_OPENED = "trade_opened"
    TRADE_CLOSED = "trade_closed"
    TRADE_ADJUSTED = "trade_adjusted"
    POSITION_UPDATE = "position_update"
    CIRCUIT_BREAKER = "circuit_breaker"
    OPTIMIZATION_RUN = "optimization_run"
    SENTIMENT_UPDATE = "sentiment_update"
    DAILY_REVIEW = "daily_review"
    ERROR = "error"


@dataclass
class Event:
    type: EventType
    data: Any
    timestamp: datetime = field(default_factory=datetime.utcnow)


class EventBus:
    """Simple pub/sub event bus using asyncio queues."""

    def __init__(self):
        self._subscribers: dict[EventType, list[Callable]] = {}
        self._queue: asyncio.Queue[Event] = asyncio.Queue()
        self._running = False

    def subscribe(self, event_type: EventType, handler: Callable[..., Coroutine]):
        """Register a handler for an event type."""
        if event_type not in self._subscribers:
            self._subscribers[event_type] = []
        self._subscribers[event_type].append(handler)

    async def publish(self, event: Event):
        """Put an event on the queue."""
        await self._queue.put(event)

    async def start(self):
        """Start processing events from the queue."""
        self._running = True
        logger.info("Event bus started")
        while self._running:
            try:
                event = await asyncio.wait_for(self._queue.get(), timeout=1.0)
                handlers = self._subscribers.get(event.type, [])
                for handler in handlers:
                    try:
                        await handler(event)
                    except Exception as e:
                        logger.error(f"Error in handler for {event.type}: {e}")
            except asyncio.TimeoutError:
                continue

    async def stop(self):
        """Stop processing events."""
        self._running = False
        logger.info("Event bus stopped")
