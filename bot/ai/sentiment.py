"""CryptoPanic news sentiment + Fear & Greed Index integration."""

import logging
from datetime import datetime
from typing import Optional

import httpx

from config.settings import settings
from db.database import Database

logger = logging.getLogger(__name__)

CRYPTOPANIC_URL = "https://cryptopanic.com/api/v1/posts/"
FEAR_GREED_URL = "https://api.alternative.me/fng/"


class SentimentAnalyzer:
    """Fetches and scores news sentiment from CryptoPanic + Fear & Greed Index."""

    def __init__(self, db: Database):
        self.db = db
        self._last_news: list[dict] = []
        self._sentiment_score: int = 50  # neutral
        self._fear_greed: Optional[int] = None
        self._last_fetch: Optional[datetime] = None
        self._breaking_news: list[dict] = []

    async def fetch_news(self) -> dict:
        """Fetch latest important crypto news from CryptoPanic.
        Budget: ~100 calls/day (3000/month).
        """
        if not settings.cryptopanic_api_key:
            return {"score": 50, "recent_news": "No API key configured"}

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(CRYPTOPANIC_URL, params={
                    "auth_token": settings.cryptopanic_api_key,
                    "currencies": "BTC,ETH,SOL,BNB,XRP",
                    "filter": "important",
                    "public": "true",
                })
                resp.raise_for_status()
                data = resp.json()

            results = data.get("results", [])
            self._last_news = results[:10]

            # Score based on votes
            positive = sum(
                r.get("votes", {}).get("positive", 0) for r in results[:10]
            )
            negative = sum(
                r.get("votes", {}).get("negative", 0) for r in results[:10]
            )
            total = positive + negative
            if total > 0:
                self._sentiment_score = int((positive / total) * 100)
            else:
                self._sentiment_score = 50

            # Check for breaking/rising news
            self._breaking_news = [
                r for r in results[:5]
                if r.get("metadata", {}).get("is_rising")
            ]

            self._last_fetch = datetime.utcnow()

            # Track API cost (CryptoPanic is prepaid, prorate monthly)
            await self.db.insert_api_cost({
                "service": "cryptopanic",
                "tokens_in": 0,
                "tokens_out": 0,
                "cost_usd": 0.0,  # prepaid plan, tracked separately
                "purpose": "sentiment",
                "created_at": datetime.utcnow().isoformat(),
            })

            latest_title = results[0]["title"] if results else "No recent news"
            logger.info(f"Sentiment score: {self._sentiment_score}/100, latest: {latest_title[:60]}")

            return {
                "score": self._sentiment_score,
                "recent_news": latest_title,
            }

        except Exception as e:
            logger.error(f"CryptoPanic fetch error: {e}")
            return {"score": self._sentiment_score, "recent_news": f"Fetch error: {e}"}

    async def fetch_fear_greed(self) -> Optional[int]:
        """Fetch Fear & Greed Index (free, unlimited)."""
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(FEAR_GREED_URL)
                resp.raise_for_status()
                data = resp.json()

            value = int(data["data"][0]["value"])
            self._fear_greed = value
            logger.info(f"Fear & Greed Index: {value}")
            return value

        except Exception as e:
            logger.error(f"Fear & Greed fetch error: {e}")
            return self._fear_greed

    def should_fetch(self) -> bool:
        """Check if enough time has passed for next sentiment fetch."""
        if self._last_fetch is None:
            return True
        elapsed = (datetime.utcnow() - self._last_fetch).total_seconds() / 60
        return elapsed >= settings.sentiment_poll_minutes

    @property
    def current_sentiment(self) -> dict:
        latest_title = self._last_news[0]["title"] if self._last_news else "No data"
        return {
            "score": self._sentiment_score,
            "recent_news": latest_title,
        }

    @property
    def fear_greed(self) -> Optional[int]:
        return self._fear_greed

    @property
    def has_breaking_news(self) -> bool:
        return len(self._breaking_news) > 0

    @property
    def breaking_headlines(self) -> list[str]:
        return [n["title"] for n in self._breaking_news]
