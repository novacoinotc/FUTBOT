"""Central configuration loaded from environment variables."""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional


class Settings(BaseSettings):
    # Binance
    binance_api_key: str = ""
    binance_api_secret: str = ""

    # Claude API
    anthropic_api_key: str = ""

    # CryptoPanic
    cryptopanic_api_key: str = ""

    # Paper trading
    paper_trading: bool = True
    initial_balance: float = 5000.0

    # API server
    api_port: int = 8080
    api_host: str = "0.0.0.0"
    cors_origin: str = "http://localhost:3000"

    # Trading defaults (auto-optimized by Claude)
    default_leverage: int = 3
    max_leverage: int = 10
    default_position_pct: float = 0.005  # 0.5% of capital
    min_position_pct: float = 0.002      # 0.2%
    max_position_pct: float = 0.015      # 1.5%
    max_open_positions: int = 5
    min_score_to_enter: float = 0.6

    # Risk limits (NON-negotiable)
    max_risk_per_trade_pct: float = 0.01  # 1%
    daily_loss_pause_pct: float = -0.02   # -2% → pause 4h
    daily_loss_stop_pct: float = -0.03    # -3% → stop for day
    total_drawdown_stop_pct: float = -0.10  # -10% → full stop

    # Fees (Binance Futures)
    taker_fee: float = 0.0005   # 0.05%
    maker_fee: float = 0.0002   # 0.02%
    slippage_major: float = 0.0001  # 0.01% BTC/ETH
    slippage_alt: float = 0.0003    # 0.03% altcoins

    # Timeframes
    analysis_interval_seconds: int = 30    # faster cycle for scalping
    optimization_interval_hours: int = 4   # optimize more frequently
    deep_analysis_interval_hours: int = 2  # learn faster
    sentiment_poll_minutes: int = 15
    funding_rate_check_minutes: int = 30   # check funding rates
    futures_data_poll_minutes: int = 5     # OI + liquidations

    # Memory
    max_similar_trades_in_prompt: int = 5
    candles_in_memory: int = 500

    # Database
    db_path: str = "bot/db/trading.db"

    model_config = {"env_file": "bot/.env", "env_file_encoding": "utf-8"}


settings = Settings()

# Major pairs get lower slippage
MAJOR_PAIRS = {"BTCUSDT", "ETHUSDT"}
