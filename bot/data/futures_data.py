"""Binance Futures REST API data: Open Interest, Funding Rates, Liquidations."""

import logging
from datetime import datetime
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Use fapi.binance.com - if 451, try fapi1.binance.com or fapi.binance.me
BINANCE_FAPI = "https://fapi.binance.com"
BINANCE_FAPI_ALT = "https://fapi1.binance.com"


class FuturesDataFetcher:
    """Fetches futures-specific data from Binance REST API."""

    def __init__(self):
        self._open_interest: dict[str, float] = {}  # pair -> OI in contracts
        self._prev_open_interest: dict[str, float] = {}  # for change tracking
        self._funding_rates: dict[str, float] = {}  # pair -> current rate
        self._long_short_ratios: dict[str, float] = {}  # pair -> ratio
        self._last_fetch: Optional[datetime] = None

    async def fetch_all(self, pairs: list[str]):
        """Fetch OI, funding rates, and L/S ratios for all pairs."""
        base_url = BINANCE_FAPI
        async with httpx.AsyncClient(timeout=15) as client:
            # Test connectivity, fallback to alt if 451
            try:
                test = await client.get(f"{base_url}/fapi/v1/premiumIndex", params={"symbol": "BTCUSDT"})
                if test.status_code == 451:
                    base_url = BINANCE_FAPI_ALT
                    logger.info(f"Binance FAPI geo-restricted, using alt: {base_url}")
            except Exception:
                pass

            await self._fetch_funding_rates(client, pairs, base_url)
            await self._fetch_open_interest(client, pairs, base_url)
            top_pairs = [p for p in pairs if p in ("BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT")]
            await self._fetch_long_short_ratios(client, top_pairs, base_url)

        self._last_fetch = datetime.utcnow()

    async def _fetch_funding_rates(self, client: httpx.AsyncClient, pairs: list[str], base_url: str = BINANCE_FAPI):
        """Fetch current funding rates for all pairs."""
        try:
            resp = await client.get(f"{base_url}/fapi/v1/premiumIndex")
            if resp.status_code == 451:
                logger.debug("Funding rates: 451 geo-restricted, skipping")
                return
            resp.raise_for_status()
            data = resp.json()
            pair_set = set(pairs)
            for item in data:
                symbol = item["symbol"]
                if symbol in pair_set:
                    rate = float(item.get("lastFundingRate", 0))
                    self._funding_rates[symbol] = rate
        except Exception as e:
            logger.warning(f"Funding rate fetch error: {e}")

    async def _fetch_open_interest(self, client: httpx.AsyncClient, pairs: list[str], base_url: str = BINANCE_FAPI):
        """Fetch open interest for pairs."""
        for pair in pairs[:10]:  # limit to top 10 to avoid rate limits
            try:
                resp = await client.get(
                    f"{base_url}/fapi/v1/openInterest",
                    params={"symbol": pair}
                )
                if resp.status_code == 451:
                    return  # geo-restricted, stop trying
                resp.raise_for_status()
                data = resp.json()
                oi = float(data.get("openInterest", 0))
                self._prev_open_interest[pair] = self._open_interest.get(pair, oi)
                self._open_interest[pair] = oi
            except Exception as e:
                logger.debug(f"OI fetch error for {pair}: {e}")

    async def _fetch_long_short_ratios(self, client: httpx.AsyncClient, pairs: list[str], base_url: str = BINANCE_FAPI):
        """Fetch top trader long/short ratio."""
        for pair in pairs:
            try:
                resp = await client.get(
                    f"{base_url}/futures/data/topLongShortAccountRatio",
                    params={"symbol": pair, "period": "5m", "limit": 1}
                )
                if resp.status_code == 451:
                    return  # geo-restricted
                resp.raise_for_status()
                data = resp.json()
                if data:
                    self._long_short_ratios[pair] = float(data[0].get("longShortRatio", 1.0))
            except Exception as e:
                logger.debug(f"L/S ratio fetch error for {pair}: {e}")

    def get_funding_rate(self, pair: str) -> Optional[float]:
        return self._funding_rates.get(pair)

    def get_open_interest(self, pair: str) -> Optional[float]:
        return self._open_interest.get(pair)

    def get_open_interest_change_pct(self, pair: str) -> Optional[float]:
        """Get OI change % since last fetch."""
        current = self._open_interest.get(pair)
        prev = self._prev_open_interest.get(pair)
        if current and prev and prev > 0:
            return (current - prev) / prev
        return None

    def get_long_short_ratio(self, pair: str) -> Optional[float]:
        return self._long_short_ratios.get(pair)

    @property
    def all_funding_rates(self) -> dict[str, float]:
        return self._funding_rates.copy()
