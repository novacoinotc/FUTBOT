"""Main engine: orchestrates the trading loop, connects all components."""

import asyncio
import logging
import time
from datetime import datetime
from typing import Optional

from config.settings import settings
from config.pairs import get_top_pairs
from core.events import EventBus, EventType, Event
from core.models import ActionType, MarketRegime, MarketSnapshot
from data.candles import CandleStore
from data.orderbook import OrderBookStore
from data.stream_manager import StreamManager
from data.futures_data import FuturesDataFetcher
from db.database import Database
from strategy.market_analyzer import MarketAnalyzer
from ai.claude_trader import ClaudeTrader
from ai.memory import MemorySystem
from ai.optimizer import Optimizer
from ai.sentiment import SentimentAnalyzer
from execution.paper_trader import PaperTrader
from execution.position_manager import PositionManager
from risk.risk_manager import RiskManager
from risk.circuit_breaker import CircuitBreaker

logger = logging.getLogger(__name__)


class TradingEngine:
    """Main engine that connects all components and runs the trading loop."""

    def __init__(self):
        # Core
        self.db = Database()
        self.event_bus = EventBus()

        # Data
        self.candle_store = CandleStore()
        self.orderbook_store = OrderBookStore()
        self.stream_manager: Optional[StreamManager] = None
        self.futures_data = FuturesDataFetcher()

        # Strategy
        self.market_analyzer = MarketAnalyzer(self.candle_store, self.orderbook_store)

        # AI
        self.claude_trader = ClaudeTrader(self.db)
        self.memory = MemorySystem(self.db)
        self.optimizer = Optimizer(self.db)
        self.sentiment = SentimentAnalyzer(self.db)

        # Execution
        self.paper_trader = PaperTrader(self.db)
        self.position_manager = PositionManager(self.paper_trader, self.db)

        # Risk
        self.risk_manager = RiskManager()
        self.circuit_breaker = CircuitBreaker()

        # State
        self.pairs: list[str] = []
        self._running = False
        self._started_at: Optional[datetime] = None
        self._analysis_count = 0
        self._last_deep_analysis: Optional[datetime] = None
        self._last_optimization: Optional[datetime] = None
        self._current_regime = MarketRegime.UNKNOWN
        self._pair_cooldown: dict[str, datetime] = {}  # pair -> last close time

    async def start(self):
        """Initialize all components and start the trading loop."""
        logger.info("=" * 60)
        logger.info("TRADING ENGINE STARTING - SKYNET MODE")
        logger.info("=" * 60)

        # Connect DB
        await self.db.connect()

        # Get top pairs
        self.pairs = await get_top_pairs(count=20)
        logger.info(f"Trading pairs: {self.pairs}")

        # Initialize optimizer params
        await self.optimizer.initialize()
        params = await self.db.get_current_params()
        self.risk_manager.update_params(params)

        # Initialize position manager
        await self.position_manager.initialize()

        # Initialize circuit breaker
        self.circuit_breaker.initialize(self.paper_trader.total_equity)

        # Fetch initial sentiment
        await self.sentiment.fetch_fear_greed()
        await self.sentiment.fetch_news()
        self.market_analyzer.set_sentiment(self.sentiment.current_sentiment)
        self.market_analyzer.set_fear_greed(self.sentiment.fear_greed or 50)

        # Fetch initial futures data
        try:
            await self.futures_data.fetch_all(self.pairs)
            self._update_futures_data()
            logger.info("Initial futures data loaded (OI, funding rates)")
        except Exception as e:
            logger.warning(f"Initial futures data fetch failed: {e}")

        # Start WebSocket streams (includes markPrice for funding rates)
        self.stream_manager = StreamManager(
            pairs=self.pairs,
            on_kline=self._on_kline,
            on_book_ticker=self._on_book_ticker,
            on_agg_trade=self._on_agg_trade,
            on_mark_price=self._on_mark_price,
        )
        await self.stream_manager.start()

        self._running = True
        self._started_at = datetime.utcnow()

        logger.info(
            f"Engine started. Balance: ${self.paper_trader.balance:.2f}, "
            f"Pairs: {len(self.pairs)}, Mode: {'PAPER' if settings.paper_trading else 'LIVE'}"
        )

        # Run main loops concurrently
        await asyncio.gather(
            self._analysis_loop(),
            self._sentiment_loop(),
            self._deep_analysis_loop(),
            self._optimization_loop(),
            self._daily_stats_loop(),
            self._health_check_loop(),
            self._futures_data_loop(),
            self._funding_rate_loop(),
        )

    async def stop(self):
        """Gracefully shut down the engine."""
        logger.info("Stopping trading engine...")
        self._running = False
        if self.stream_manager:
            await self.stream_manager.stop()
        try:
            await self.position_manager.compute_daily_stats()
        except Exception as e:
            logger.warning(f"Could not compute final stats: {e}")
        try:
            await self.db.close()
        except Exception:
            pass
        logger.info("Engine stopped.")

    # --- WebSocket Handlers ---

    async def _on_kline(self, data: dict):
        """Handle incoming kline data - check SL/TP/liquidation on kline updates."""
        self.candle_store.update_from_kline(data)

        pair = data["s"]
        kline = data["k"]
        price = float(kline["c"])
        high = float(kline["h"])
        low = float(kline["l"])

        # Update position with latest price
        self.paper_trader.update_position_price(pair, price)

        # Update trailing stops
        self.paper_trader.update_trailing_stops(pair)

        # Check SL/TP/liquidation using candle HIGH and LOW (catches wicks)
        position = self.paper_trader.positions.get(pair)
        if position:
            # Grace period: let position breathe for 15 seconds after opening
            hold_seconds = (datetime.utcnow() - position.opened_at).total_seconds()
            if hold_seconds < 15:
                # Only check liquidation during grace period (safety net)
                liq_trigger = None
                if position.direction.value == "LONG" and position.liquidation_price > 0 and low <= position.liquidation_price:
                    liq_trigger = "liq"
                elif position.direction.value == "SHORT" and position.liquidation_price > 0 and high >= position.liquidation_price:
                    liq_trigger = "liq"
                if liq_trigger:
                    trade = await self.paper_trader.close_position(pair, position.liquidation_price, f"LIQUIDATED at {price:.4f}")
                    if trade:
                        await self.memory.record_trade(trade, {}, self._current_regime)
                return

            trigger = None
            if position.direction.value == "LONG":
                trigger = self.paper_trader.check_stop_loss_take_profit(pair, low)
                if not trigger:
                    trigger = self.paper_trader.check_stop_loss_take_profit(pair, high)
            else:
                trigger = self.paper_trader.check_stop_loss_take_profit(pair, high)
                if not trigger:
                    trigger = self.paper_trader.check_stop_loss_take_profit(pair, low)

            if not trigger:
                trigger = self.paper_trader.check_stop_loss_take_profit(pair, price)

            if trigger:
                if trigger == "liq":
                    reason = f"LIQUIDATED at {price:.4f}"
                    trade = await self.paper_trader.close_position(pair, position.liquidation_price, reason)
                elif trigger == "sl":
                    reason = f"Stop loss hit at {price:.4f}"
                    trade = await self.paper_trader.close_position(pair, position.stop_loss, reason)
                elif trigger == "tp":
                    reason = f"Take profit hit at {price:.4f}"
                    trade = await self.paper_trader.close_position(pair, position.take_profit, reason)
                else:
                    trade = await self.paper_trader.close_position(pair, price, trigger)

                if trade:
                    self._pair_cooldown[pair] = datetime.utcnow()
                    indicators = {}
                    await self.memory.record_trade(trade, indicators, self._current_regime)

    async def _on_book_ticker(self, data: dict):
        """Handle incoming order book ticker - price tracking only (SL checked on kline)."""
        self.orderbook_store.update_from_book_ticker(data)

        pair = data["s"]
        if pair in self.paper_trader.positions:
            mid = (float(data["b"]) + float(data["a"])) / 2
            self.paper_trader.update_position_price(pair, mid)
            self.paper_trader.update_trailing_stops(pair)

    async def _on_agg_trade(self, data: dict):
        """Handle aggregate trade data - price tracking only (SL checked on kline)."""
        pair = data["s"]
        if pair not in self.paper_trader.positions:
            return

        price = float(data["p"])
        self.paper_trader.update_position_price(pair, price)
        self.paper_trader.update_trailing_stops(pair)

    async def _on_mark_price(self, data: dict):
        """Handle markPrice stream - extract funding rates in real-time."""
        pair = data.get("s", "")
        funding_rate = float(data.get("r", 0))  # current funding rate
        if pair and funding_rate:
            self.market_analyzer.set_funding_rate(pair, funding_rate)

    # --- Main Analysis Loop ---

    async def _analysis_loop(self):
        """Main loop: analyze each pair every ~30 seconds."""
        await asyncio.sleep(30)  # wait for data

        while self._running:
            try:
                self.position_manager.check_new_day()
                self.circuit_breaker.check_new_day(self.paper_trader.total_equity)

                params = await self.db.get_current_params()
                self.risk_manager.update_params(params)

                # Update fear/greed in risk manager
                if self.sentiment.fear_greed:
                    self.risk_manager.update_fear_greed(self.sentiment.fear_greed)

                # Fast regime detection every cycle
                self._current_regime = self.market_analyzer.get_market_regime_consensus(self.pairs)

                active_pairs = self.candle_store.pairs_with_data
                if not active_pairs:
                    counts = self.candle_store.get_candle_counts()
                    max_count = max(counts.values()) if counts else 0
                    total_pairs_receiving = len(counts)
                    logger.info(
                        f"Accumulating data: {total_pairs_receiving} pairs receiving, "
                        f"max {max_count}/14 candles (need ~{max(0, 14-max_count)} more minutes)"
                    )
                    await asyncio.sleep(10)
                    continue

                # Prioritize pairs with open positions
                position_pairs = [p for p in active_pairs if p in self.paper_trader.positions]
                other_pairs = [p for p in active_pairs if p not in self.paper_trader.positions]
                ordered_pairs = position_pairs + other_pairs

                # Score all pairs and sort by signal strength
                scored_pairs = []
                for pair in ordered_pairs:
                    snapshot = self.market_analyzer.get_snapshot(pair)
                    if snapshot:
                        scored_pairs.append((pair, self._signal_score(snapshot)))

                # Sort by score descending, always analyze at least top 5
                scored_pairs.sort(key=lambda x: x[1], reverse=True)
                min_analyze = min(5, len(scored_pairs))

                analyzed = 0
                for pair, score in scored_pairs:
                    if not self._running:
                        break
                    # Analyze if: has open position, score >= 2, or in top 5
                    if pair not in self.paper_trader.positions and score < 2 and analyzed >= min_analyze:
                        continue

                    await self._analyze_pair(pair, params)
                    analyzed += 1
                    await asyncio.sleep(0.3)

                if self._analysis_count % 5 == 0:
                    top_scores = [(p, s) for p, s in scored_pairs[:5]]
                    logger.info(f"Cycle {self._analysis_count}: analyzed {analyzed}/{len(scored_pairs)}, top: {top_scores}")

                self._analysis_count += 1
                await asyncio.sleep(settings.analysis_interval_seconds)

            except Exception as e:
                logger.error(f"Analysis loop error: {e}", exc_info=True)
                await asyncio.sleep(5)

    def _signal_score(self, snapshot: MarketSnapshot) -> int:
        """Score a pair's signal strength (0-15+). Higher = more interesting for Claude."""
        adx = snapshot.adx or 0
        rsi_7 = snapshot.rsi_7 or 50
        bb_squeeze = snapshot.bb_squeeze or False
        bb_pct = snapshot.bb_pct or 0.5
        macd_hist = snapshot.macd_hist or 0
        ema_alignment = snapshot.ema_alignment or 0
        rsi_divergence = snapshot.rsi_divergence or "none"
        consecutive = snapshot.consecutive_direction or 0
        volume_buy_ratio = snapshot.volume_buy_ratio or 0.5
        stoch_k = snapshot.stoch_rsi_k or 50

        score = 0

        if adx > 25: score += 2
        elif adx > 18: score += 1

        if rsi_7 < 25 or rsi_7 > 75: score += 2
        elif rsi_7 < 35 or rsi_7 > 65: score += 1

        if bb_squeeze: score += 2

        if bb_pct < 0.05 or bb_pct > 0.95: score += 2
        elif bb_pct < 0.15 or bb_pct > 0.85: score += 1

        if abs(macd_hist) > 0: score += 1
        if abs(ema_alignment) > 0.5: score += 1
        if rsi_divergence != "none": score += 2
        if abs(consecutive) >= 3: score += 2
        if volume_buy_ratio < 0.3 or volume_buy_ratio > 0.7: score += 1
        if stoch_k < 10 or stoch_k > 90: score += 1

        return score

    async def _analyze_pair(self, pair: str, params: dict):
        """Analyze a single pair and execute Claude's decision."""
        # Get market snapshot
        snapshot = self.market_analyzer.get_snapshot(pair)
        if not snapshot:
            return

        has_position = pair in self.paper_trader.positions

        # Per-pair cooldown: don't enter a pair that was just closed
        if not has_position and pair in self._pair_cooldown:
            elapsed = (datetime.utcnow() - self._pair_cooldown[pair]).total_seconds()
            if elapsed < 180:  # 3-minute cooldown between trades on same pair
                return

        # Min hold time: don't ask Claude about young positions (let SL/TP work)
        if has_position:
            position = self.paper_trader.positions[pair]
            hold_minutes = (datetime.utcnow() - position.opened_at).total_seconds() / 60
            if hold_minutes < 3.0:
                return  # Let the trade breathe — SL/TP protect it

        # Get context for Claude
        regime = self._current_regime.value
        similar_trades = await self.memory.find_similar(pair, regime)
        active_rules = await self.memory.get_active_rules()
        open_positions = self.position_manager.get_open_positions()

        # Check circuit breaker
        cb_active, cb_reason = self.circuit_breaker.check(self.paper_trader.total_equity)

        # Get win-rate statistics
        pattern_stats = await self.memory.get_pattern_stats(
            pair=pair, direction="", market_regime=regime
        )

        # Ask Claude for decision
        decision = await self.claude_trader.make_decision(
            snapshot=snapshot,
            open_positions=open_positions,
            similar_trades=similar_trades,
            active_rules=active_rules,
            current_params=params,
            balance=self.paper_trader.balance,
            pattern_stats=pattern_stats,
        )

        # Validate with risk manager
        is_valid, rejection = self.risk_manager.validate(
            decision=decision,
            balance=self.paper_trader.balance,
            open_positions=len(self.paper_trader.positions),
            has_position_for_pair=has_position,
            circuit_breaker_active=cb_active,
            margin_ratio=self.paper_trader.margin_ratio,
        )

        if not is_valid:
            if decision.action != ActionType.HOLD:
                logger.info(f"[{pair}] Decision rejected: {rejection}")
            return

        # Execute decision
        price = self.candle_store.get_latest_price(pair) or snapshot.price

        if decision.action in (ActionType.ENTER_LONG, ActionType.ENTER_SHORT):
            position = await self.paper_trader.open_position(decision, price)
            if position:
                # Enable trailing stop based on ATR (wider to let trades breathe)
                atr = snapshot.atr_14
                if atr:
                    self.paper_trader.set_trailing_stop(pair, atr * 2.5)

                # Store indicators with the trade
                indicators = snapshot.model_dump(exclude_none=True, exclude={"timestamp"})
                await self.db.update_trade(position.id, {
                    "entry_indicators": str(indicators),
                    "market_regime": regime,
                    "sentiment_score": snapshot.fear_greed,
                })

        elif decision.action == ActionType.EXIT:
            trade = await self.paper_trader.close_position(pair, price, decision.reasoning)
            if trade:
                self._pair_cooldown[pair] = datetime.utcnow()
                indicators = snapshot.model_dump(exclude_none=True, exclude={"timestamp"})
                await self.memory.record_trade(trade, indicators, self._current_regime)

        elif decision.action == ActionType.ADJUST:
            position = self.paper_trader.positions.get(pair)
            if position:
                if decision.stop_loss:
                    position.stop_loss = decision.stop_loss
                if decision.take_profit:
                    position.take_profit = decision.take_profit
                logger.info(f"[{pair}] Adjusted: SL={position.stop_loss} TP={position.take_profit}")

    # --- Futures Data Loop ---

    async def _futures_data_loop(self):
        """Fetch OI, funding rates, L/S ratios every 5 minutes."""
        await asyncio.sleep(60)  # wait for startup

        while self._running:
            # Skip entirely if REST API is geo-restricted (we use WS markPrice instead)
            if self.futures_data._geo_restricted:
                await asyncio.sleep(3600)  # check once per hour in case it becomes available
                self.futures_data._geo_restricted = False  # retry
                continue

            try:
                await self.futures_data.fetch_all(self.pairs)
                self._update_futures_data()
            except Exception as e:
                logger.error(f"Futures data loop error: {e}")

            await asyncio.sleep(settings.futures_data_poll_minutes * 60)

    def _update_futures_data(self):
        """Push futures data into market analyzer."""
        for pair in self.pairs:
            rate = self.futures_data.get_funding_rate(pair)
            if rate is not None:
                self.market_analyzer.set_funding_rate(pair, rate)

            oi = self.futures_data.get_open_interest(pair)
            if oi is not None:
                oi_change = self.futures_data.get_open_interest_change_pct(pair)
                self.market_analyzer.set_open_interest(pair, oi, oi_change)

            ls_ratio = self.futures_data.get_long_short_ratio(pair)
            if ls_ratio is not None:
                self.market_analyzer.set_long_short_ratio(pair, ls_ratio)

    # --- Funding Rate Application Loop ---

    async def _funding_rate_loop(self):
        """Apply funding rates to open positions. Binance charges every 8h."""
        await asyncio.sleep(120)  # wait for data

        while self._running:
            try:
                for pair, position in list(self.paper_trader.positions.items()):
                    rate = self.futures_data.get_funding_rate(pair)
                    if rate is not None and rate != 0:
                        hold_hours = (datetime.utcnow() - position.opened_at).total_seconds() / 3600
                        # Apply proportional funding: full rate every 8h
                        # Check interval is 30 min, so apply 30/480 = 6.25% of rate
                        check_minutes = settings.funding_rate_check_minutes
                        fraction = check_minutes / (8 * 60)
                        proportional_rate = rate * fraction
                        self.paper_trader.apply_funding_rate(pair, proportional_rate)

            except Exception as e:
                logger.error(f"Funding rate loop error: {e}")

            await asyncio.sleep(settings.funding_rate_check_minutes * 60)

    # --- Sentiment Loop ---

    async def _sentiment_loop(self):
        """Fetch sentiment every 15 minutes."""
        while self._running:
            try:
                if self.sentiment.should_fetch():
                    news = await self.sentiment.fetch_news()
                    fg = await self.sentiment.fetch_fear_greed()
                    self.market_analyzer.set_sentiment(news)
                    if fg:
                        self.market_analyzer.set_fear_greed(fg)
                        self.risk_manager.update_fear_greed(fg)

                    # Breaking news integration
                    if self.sentiment.has_breaking_news:
                        headlines = "; ".join(self.sentiment.breaking_headlines[:2])
                        self.market_analyzer.set_breaking_news(headlines)
                        logger.warning(f"BREAKING NEWS: {headlines}")
                    else:
                        self.market_analyzer.set_breaking_news(None)

            except Exception as e:
                logger.error(f"Sentiment loop error: {e}")

            await asyncio.sleep(settings.sentiment_poll_minutes * 60)

    # --- Deep Analysis Loop ---

    async def _deep_analysis_loop(self):
        """Run deep analysis with Claude Sonnet every 2 hours."""
        await asyncio.sleep(3600)  # wait 1h before first analysis (need trades first)

        while self._running:
            try:
                recent_trades = await self.db.get_trades(status="closed", limit=50)
                if recent_trades:
                    memories = await self.memory.get_recent_memories(limit=15)
                    params = await self.db.get_current_params()
                    market_summary = self.market_analyzer.get_market_summary(self.pairs)

                    result = await self.claude_trader.deep_analysis(
                        recent_trades=recent_trades,
                        current_params=params,
                        market_summary=market_summary,
                        memories=memories,
                    )

                    if "error" not in result:
                        # Update market regime
                        regime = result.get("market_regime", "unknown")
                        self._current_regime = MarketRegime(regime) if regime in MarketRegime.__members__.values() else MarketRegime.UNKNOWN

                        # Update lessons
                        reviews = result.get("trade_reviews", [])
                        await self.memory.update_lessons(reviews)

                        # Add new rules
                        for rule in result.get("proposed_rules", []):
                            await self.memory.add_rule(
                                rule=rule["rule"],
                                source_trades=[],
                                confidence=rule.get("confidence", 0.5),
                            )

                        # Cleanup poor-performing rules
                        await self.memory.cleanup_rules()

                        logger.info(f"Deep analysis complete. Regime: {regime}, Reviews: {len(reviews)}")

                self._last_deep_analysis = datetime.utcnow()

            except Exception as e:
                logger.error(f"Deep analysis error: {e}", exc_info=True)

            await asyncio.sleep(settings.deep_analysis_interval_hours * 3600)

    # --- Optimization Loop ---

    async def _optimization_loop(self):
        """Run optimizer every 4 hours."""
        await asyncio.sleep(7200)  # wait 2h before first optimization (need new trades first)

        while self._running:
            try:
                if await self.optimizer.should_run():
                    recent_trades = await self.db.get_trades(status="closed", limit=50)
                    if len(recent_trades) >= 10:  # need sufficient data for meaningful optimization
                        daily_stats = await self.position_manager.compute_daily_stats()
                        changes = await self.optimizer.run(daily_stats, recent_trades)
                        if changes:
                            params = await self.db.get_current_params()
                            self.risk_manager.update_params(params)

                self._last_optimization = datetime.utcnow()

            except Exception as e:
                logger.error(f"Optimization loop error: {e}", exc_info=True)

            await asyncio.sleep(settings.optimization_interval_hours * 3600)

    # --- Daily Stats Loop ---

    async def _daily_stats_loop(self):
        """Compute and save daily stats every hour."""
        while self._running:
            try:
                await self.position_manager.compute_daily_stats()
            except Exception as e:
                logger.error(f"Daily stats error: {e}")
            await asyncio.sleep(3600)

    # --- Health Check ---

    async def _health_check_loop(self):
        """Monitor system health every 30 seconds."""
        while self._running:
            try:
                if self.stream_manager and self.stream_manager.seconds_since_last_message > 60:
                    logger.warning("No WebSocket data for >60s, streams may be disconnected")

                # Log periodic status
                if self._analysis_count > 0 and self._analysis_count % 10 == 0:
                    equity = self.paper_trader.total_equity
                    pnl = equity - self.paper_trader.initial_balance
                    positions = len(self.paper_trader.positions)
                    logger.info(
                        f"Status: equity=${equity:.2f} pnl=${pnl:.2f} "
                        f"positions={positions} regime={self._current_regime.value} "
                        f"cycles={self._analysis_count}"
                    )

            except Exception as e:
                logger.error(f"Health check error: {e}")

            await asyncio.sleep(30)

    # --- Status ---

    def get_status(self) -> dict:
        """Get comprehensive engine status for the API."""
        cb_active, cb_reason = self.circuit_breaker.check(self.paper_trader.total_equity)

        return {
            "running": self._running,
            "mode": "paper" if settings.paper_trading else "live",
            "started_at": self._started_at.isoformat() if self._started_at else None,
            "uptime_minutes": round(
                (datetime.utcnow() - self._started_at).total_seconds() / 60, 1
            ) if self._started_at else 0,
            "pairs": self.pairs,
            "active_pairs": self.candle_store.pairs_with_data,
            "analysis_cycles": self._analysis_count,
            "market_regime": self._current_regime.value,
            "circuit_breaker": {
                "active": cb_active,
                "reason": cb_reason,
                **self.circuit_breaker.status,
            },
            "ws_connected": self.stream_manager.is_connected if self.stream_manager else False,
            "last_deep_analysis": self._last_deep_analysis.isoformat() if self._last_deep_analysis else None,
            "last_optimization": self._last_optimization.isoformat() if self._last_optimization else None,
            **self.position_manager.get_equity_summary(),
        }
