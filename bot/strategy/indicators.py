"""Technical indicators implemented with pure numpy/pandas (no pandas_ta dependency)."""

import logging
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


def _rsi(series: pd.Series, length: int) -> pd.Series:
    """Relative Strength Index."""
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1 / length, min_periods=length).mean()
    avg_loss = loss.ewm(alpha=1 / length, min_periods=length).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _ema(series: pd.Series, length: int) -> pd.Series:
    """Exponential Moving Average."""
    return series.ewm(span=length, adjust=False).mean()


def _bbands(series: pd.Series, length: int = 20, std: float = 2.0):
    """Bollinger Bands → (upper, mid, lower)."""
    mid = series.rolling(length).mean()
    std_dev = series.rolling(length).std()
    upper = mid + std * std_dev
    lower = mid - std * std_dev
    return upper, mid, lower


def _macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    """MACD → (macd_line, signal_line, histogram)."""
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.Series:
    """Average True Range."""
    prev_close = close.shift(1)
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / length, min_periods=length).mean()


def _stoch_rsi(close: pd.Series, rsi_length: int = 14, stoch_length: int = 14, k: int = 3, d: int = 3):
    """Stochastic RSI → (K line, D line). Key for scalping overbought/oversold."""
    rsi = _rsi(close, rsi_length)
    rsi_min = rsi.rolling(stoch_length).min()
    rsi_max = rsi.rolling(stoch_length).max()
    stoch_rsi = (rsi - rsi_min) / (rsi_max - rsi_min).replace(0, np.nan)
    k_line = stoch_rsi.rolling(k).mean() * 100
    d_line = k_line.rolling(d).mean()
    return k_line, d_line


def _adx(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14):
    """ADX + DI+ / DI- → (ADX, +DI, -DI). Trend strength indicator."""
    prev_high = high.shift(1)
    prev_low = low.shift(1)
    plus_dm = (high - prev_high).where((high - prev_high) > (prev_low - low), 0.0).clip(lower=0)
    minus_dm = (prev_low - low).where((prev_low - low) > (high - prev_high), 0.0).clip(lower=0)
    atr = _atr(high, low, close, length)
    plus_di = 100 * (plus_dm.ewm(alpha=1 / length, min_periods=length).mean() / atr.replace(0, np.nan))
    minus_di = 100 * (minus_dm.ewm(alpha=1 / length, min_periods=length).mean() / atr.replace(0, np.nan))
    dx = (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan) * 100
    adx = dx.ewm(alpha=1 / length, min_periods=length).mean()
    return adx, plus_di, minus_di


def _mfi(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, length: int = 14) -> pd.Series:
    """Money Flow Index - volume-weighted RSI. Detects divergences."""
    typical = (high + low + close) / 3
    raw_money_flow = typical * volume
    delta = typical.diff()
    pos_flow = raw_money_flow.where(delta > 0, 0.0).rolling(length).sum()
    neg_flow = raw_money_flow.where(delta <= 0, 0.0).rolling(length).sum()
    mfi = 100 - (100 / (1 + pos_flow / neg_flow.replace(0, np.nan)))
    return mfi


# --- Advanced features ---

def _rsi_divergence(close: pd.Series, rsi: pd.Series, lookback: int = 14) -> str:
    """Detect RSI/price divergence over lookback period.
    Returns 'bullish_div', 'bearish_div', or 'none'.
    """
    if len(close) < lookback + 2 or len(rsi) < lookback + 2:
        return "none"

    c = close.dropna()
    r = rsi.dropna()
    if len(c) < lookback + 2 or len(r) < lookback + 2:
        return "none"

    # Get recent swing low/high
    recent_c = c.iloc[-lookback:]
    recent_r = r.iloc[-lookback:]
    older_c = c.iloc[-(lookback * 2):-lookback] if len(c) >= lookback * 2 else c.iloc[:lookback]
    older_r = r.iloc[-(lookback * 2):-lookback] if len(r) >= lookback * 2 else r.iloc[:lookback]

    if older_c.empty or older_r.empty:
        return "none"

    # Bullish divergence: price makes lower low, RSI makes higher low
    if recent_c.min() < older_c.min() and recent_r.min() > older_r.min():
        return "bullish_div"

    # Bearish divergence: price makes higher high, RSI makes lower high
    if recent_c.max() > older_c.max() and recent_r.max() < older_r.max():
        return "bearish_div"

    return "none"


def _consecutive_direction(close: pd.Series, count: int = 10) -> int:
    """Count consecutive candles in same direction.
    Returns positive for green streaks, negative for red streaks.
    """
    if len(close) < 2:
        return 0
    changes = close.diff().dropna().tail(count)
    if changes.empty:
        return 0

    streak = 0
    last_sign = 1 if changes.iloc[-1] > 0 else -1
    for val in reversed(changes.values):
        current_sign = 1 if val > 0 else -1
        if current_sign == last_sign:
            streak += current_sign
        else:
            break
    return streak


def _ema_alignment(ema_9: float, ema_21: float, ema_50: float) -> float:
    """EMA alignment score: -1 to +1.
    +1 = perfect bullish stack (9>21>50), -1 = perfect bearish stack.
    """
    if not all([ema_9, ema_21, ema_50]):
        return 0.0

    score = 0.0
    if ema_9 > ema_21:
        score += 0.5
    else:
        score -= 0.5
    if ema_21 > ema_50:
        score += 0.5
    else:
        score -= 0.5
    return score


def _price_position_in_range(close: pd.Series, lookback: int = 20) -> Optional[float]:
    """Position of current price in recent high/low range (0=at low, 1=at high)."""
    if len(close) < lookback:
        return None
    recent = close.tail(lookback)
    high = recent.max()
    low = recent.min()
    if high == low:
        return 0.5
    return (close.iloc[-1] - low) / (high - low)


def _volume_buy_ratio(df: pd.DataFrame, lookback: int = 5) -> Optional[float]:
    """Ratio of buy volume to total volume (0-1). >0.5 = more buying."""
    if "taker_buy_quote_volume" not in df.columns or "quote_volume" not in df.columns:
        return None
    recent = df.tail(lookback)
    buy = recent["taker_buy_quote_volume"].sum()
    total = recent["quote_volume"].sum()
    if total == 0:
        return 0.5
    return round(buy / total, 4)


def calculate_all(df: pd.DataFrame) -> dict:
    """Calculate all indicators from OHLCV DataFrame. Returns a flat dict.
    Each indicator handles its own data requirements — returns None if insufficient."""
    if df.empty or len(df) < 10:
        return {}

    result = {}

    try:
        close = df["close"]
        price = close.iloc[-1]

        # RSI
        rsi_7 = _rsi(close, 7)
        rsi_14 = _rsi(close, 14)
        result["rsi_7"] = _last(rsi_7)
        result["rsi_14"] = _last(rsi_14)

        # EMA
        ema_9 = _ema(close, 9)
        ema_21 = _ema(close, 21)
        ema_50 = _ema(close, 50)
        result["ema_9"] = _last(ema_9)
        result["ema_21"] = _last(ema_21)
        result["ema_50"] = _last(ema_50)

        # Bollinger Bands
        bb_upper, bb_mid, bb_lower = _bbands(close, 20, 2.0)
        result["bb_upper"] = _last(bb_upper)
        result["bb_lower"] = _last(bb_lower)
        upper = result.get("bb_upper")
        lower = result.get("bb_lower")
        if upper and lower and (upper - lower) > 0:
            result["bb_pct"] = round((price - lower) / (upper - lower), 4)

        # MACD
        macd_line, signal_line, histogram = _macd(close, 12, 26, 9)
        hist_val = _last(histogram)
        result["macd_hist"] = hist_val

        hist_clean = histogram.dropna()
        if len(hist_clean) >= 2:
            prev = hist_clean.iloc[-2]
            curr = hist_clean.iloc[-1]
            if prev < 0 and curr > 0:
                result["macd_signal"] = "bullish_cross"
            elif prev > 0 and curr < 0:
                result["macd_signal"] = "bearish_cross"
            elif curr > 0:
                result["macd_signal"] = "bullish"
            else:
                result["macd_signal"] = "bearish"

        # ATR
        atr = _atr(df["high"], df["low"], close, 14)
        result["atr_14"] = _last(atr)

        # VWAP
        if "volume" in df.columns:
            typical = (df["high"] + df["low"] + close) / 3
            cum_vol = df["volume"].cumsum()
            cum_tp_vol = (typical * df["volume"]).cumsum()
            vwap_series = cum_tp_vol / cum_vol
            result["vwap"] = _last(vwap_series)
            vwap_val = result.get("vwap")
            if vwap_val:
                result["price_vs_vwap"] = "above" if price > vwap_val else "below"

        # Volume Delta
        if "taker_buy_quote_volume" in df.columns and "quote_volume" in df.columns:
            last_5 = df.tail(5)
            buy_vol = last_5["taker_buy_quote_volume"].sum()
            total_vol = last_5["quote_volume"].sum()
            sell_vol = total_vol - buy_vol
            result["volume_delta_5m"] = round(buy_vol - sell_vol, 2)

        # Stochastic RSI
        stoch_k, stoch_d = _stoch_rsi(close, 14, 14, 3, 3)
        result["stoch_rsi_k"] = _last(stoch_k)
        result["stoch_rsi_d"] = _last(stoch_d)

        # ADX + DI
        adx, plus_di, minus_di = _adx(df["high"], df["low"], close, 14)
        result["adx"] = _last(adx)
        result["plus_di"] = _last(plus_di)
        result["minus_di"] = _last(minus_di)

        # MFI
        if "volume" in df.columns:
            mfi = _mfi(df["high"], df["low"], close, df["volume"], 14)
            result["mfi"] = _last(mfi)

        # BB Squeeze
        atr_val = result.get("atr_14")
        bb_upper_val = result.get("bb_upper")
        bb_lower_val = result.get("bb_lower")
        if atr_val and bb_upper_val and bb_lower_val and price > 0:
            bb_width = (bb_upper_val - bb_lower_val) / price
            result["bb_width"] = round(bb_width, 6)
            result["bb_squeeze"] = bb_width < 0.02

        # Normalized ATR
        if atr_val and price > 0:
            result["atr_pct"] = round(atr_val / price * 100, 4)

        # === ADVANCED FEATURES ===

        # RSI Divergence (bullish/bearish divergence detection)
        result["rsi_divergence"] = _rsi_divergence(close, rsi_14, 14)

        # Consecutive candle direction
        result["consecutive_direction"] = _consecutive_direction(close)

        # EMA alignment score (-1 to +1)
        result["ema_alignment"] = _ema_alignment(
            result.get("ema_9"), result.get("ema_21"), result.get("ema_50")
        )

        # Price position in 20-candle range (0=low, 1=high)
        pos_range = _price_position_in_range(close, 20)
        if pos_range is not None:
            result["price_position_range"] = round(pos_range, 4)

        # Volume buy ratio (0-1)
        vbr = _volume_buy_ratio(df, 5)
        if vbr is not None:
            result["volume_buy_ratio"] = vbr

    except Exception as e:
        logger.error(f"Error calculating indicators: {e}")

    return result


def calculate_5m(df_5m: pd.DataFrame) -> dict:
    """Calculate key indicators on 5-minute timeframe for multi-timeframe context."""
    if df_5m.empty or len(df_5m) < 5:
        return {}

    result = {}
    try:
        close = df_5m["close"]
        price = close.iloc[-1]

        # RSI 14 on 5m
        rsi_14 = _rsi(close, 14)
        result["rsi_14_5m"] = _last(rsi_14)

        # EMA trend on 5m
        ema_9 = _last(_ema(close, 9))
        ema_21 = _last(_ema(close, 21))
        if ema_9 and ema_21:
            if price > ema_9 > ema_21:
                result["ema_trend_5m"] = "strong_bullish"
            elif price > ema_9 or price > ema_21:
                result["ema_trend_5m"] = "bullish"
            elif price < ema_9 < ema_21:
                result["ema_trend_5m"] = "strong_bearish"
            elif price < ema_9 or price < ema_21:
                result["ema_trend_5m"] = "bearish"
            else:
                result["ema_trend_5m"] = "neutral"

        # ADX on 5m
        adx, _, _ = _adx(df_5m["high"], df_5m["low"], close, 14)
        result["adx_5m"] = _last(adx)

        # MACD signal on 5m
        _, _, histogram = _macd(close, 12, 26, 9)
        hist_clean = histogram.dropna()
        if len(hist_clean) >= 2:
            prev = hist_clean.iloc[-2]
            curr = hist_clean.iloc[-1]
            if prev < 0 and curr > 0:
                result["macd_signal_5m"] = "bullish_cross"
            elif prev > 0 and curr < 0:
                result["macd_signal_5m"] = "bearish_cross"
            elif curr > 0:
                result["macd_signal_5m"] = "bullish"
            else:
                result["macd_signal_5m"] = "bearish"

    except Exception as e:
        logger.error(f"Error calculating 5m indicators: {e}")

    return result


def _last(series) -> Optional[float]:
    """Get last non-NaN value from a series."""
    if series is None or series.empty:
        return None
    val = series.dropna()
    if val.empty:
        return None
    v = float(val.iloc[-1])
    return round(v, 6) if abs(v) < 1e10 else round(v, 2)
