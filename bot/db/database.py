"""SQLite database: trades, memory, params, costs, daily_stats."""

import aiosqlite
import json
import logging
from datetime import datetime
from typing import Optional
from config.settings import settings

logger = logging.getLogger(__name__)

DB_PATH = settings.db_path

SCHEMA = """
CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL,
    quantity REAL NOT NULL,
    leverage INTEGER NOT NULL,
    pnl REAL DEFAULT 0,
    pnl_pct REAL DEFAULT 0,
    entry_fee REAL DEFAULT 0,
    exit_fee REAL DEFAULT 0,
    margin_used REAL DEFAULT 0,
    hold_time_minutes REAL DEFAULT 0,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    entry_reasoning TEXT DEFAULT '',
    exit_reasoning TEXT DEFAULT '',
    entry_indicators TEXT DEFAULT '{}',
    exit_indicators TEXT DEFAULT '{}',
    market_regime TEXT DEFAULT 'unknown',
    sentiment_score INTEGER,
    status TEXT DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS trade_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT NOT NULL,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    pnl REAL NOT NULL,
    pnl_pct REAL NOT NULL,
    leverage INTEGER NOT NULL,
    hold_time_minutes REAL NOT NULL,
    market_regime TEXT NOT NULL,
    indicators_at_entry TEXT NOT NULL,
    sentiment_score INTEGER,
    claude_reasoning TEXT NOT NULL,
    lesson_learned TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY (trade_id) REFERENCES trades(id)
);

CREATE TABLE IF NOT EXISTS learned_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule TEXT NOT NULL,
    source_trades TEXT DEFAULT '[]',
    confidence REAL DEFAULT 0.5,
    times_applied INTEGER DEFAULT 0,
    times_successful INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parameters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    param_name TEXT NOT NULL,
    old_value REAL NOT NULL,
    new_value REAL NOT NULL,
    reasoning TEXT NOT NULL,
    performance_before TEXT DEFAULT '{}',
    performance_after TEXT DEFAULT '{}',
    reverted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS current_params (
    param_name TEXT PRIMARY KEY,
    param_value REAL NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT NOT NULL,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    cost_usd REAL NOT NULL,
    purpose TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    starting_balance REAL NOT NULL,
    ending_balance REAL NOT NULL,
    pnl_gross REAL DEFAULT 0,
    pnl_net REAL DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    total_fees REAL DEFAULT 0,
    total_api_costs REAL DEFAULT 0,
    max_drawdown_pct REAL DEFAULT 0,
    best_trade_pnl REAL DEFAULT 0,
    worst_trade_pnl REAL DEFAULT 0,
    avg_hold_time_minutes REAL DEFAULT 0,
    sharpe_ratio REAL
);

CREATE INDEX IF NOT EXISTS idx_trades_pair ON trades(pair);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_closed_at ON trades(closed_at);
CREATE INDEX IF NOT EXISTS idx_memory_pair ON trade_memory(pair);
CREATE INDEX IF NOT EXISTS idx_memory_regime ON trade_memory(market_regime);
CREATE INDEX IF NOT EXISTS idx_costs_service ON api_costs(service);
CREATE INDEX IF NOT EXISTS idx_costs_created ON api_costs(created_at);
"""


class Database:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._db: Optional[aiosqlite.Connection] = None

    async def connect(self):
        self._db = await aiosqlite.connect(self.db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(SCHEMA)
        await self._db.commit()
        logger.info(f"Database connected: {self.db_path}")

    async def close(self):
        if self._db:
            await self._db.close()

    @property
    def db(self) -> aiosqlite.Connection:
        assert self._db is not None, "Database not connected"
        return self._db

    # --- Trades ---

    async def insert_trade(self, trade: dict):
        cols = ", ".join(trade.keys())
        placeholders = ", ".join(["?"] * len(trade))
        values = [
            json.dumps(v) if isinstance(v, (dict, list)) else v
            for v in trade.values()
        ]
        await self.db.execute(
            f"INSERT INTO trades ({cols}) VALUES ({placeholders})", values
        )
        await self.db.commit()

    async def update_trade(self, trade_id: str, updates: dict):
        sets = ", ".join([f"{k} = ?" for k in updates.keys()])
        values = [
            json.dumps(v) if isinstance(v, (dict, list)) else v
            for v in updates.values()
        ]
        values.append(trade_id)
        await self.db.execute(
            f"UPDATE trades SET {sets} WHERE id = ?", values
        )
        await self.db.commit()

    async def get_open_trades(self) -> list[dict]:
        cursor = await self.db.execute(
            "SELECT * FROM trades WHERE status = 'open' ORDER BY opened_at DESC"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def get_trades(
        self,
        pair: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        query = "SELECT * FROM trades WHERE 1=1"
        params: list = []
        if pair:
            query += " AND pair = ?"
            params.append(pair)
        if status:
            query += " AND status = ?"
            params.append(status)
        query += " ORDER BY opened_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        cursor = await self.db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def get_trade_by_id(self, trade_id: str) -> Optional[dict]:
        cursor = await self.db.execute("SELECT * FROM trades WHERE id = ?", [trade_id])
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def count_trades(self, status: Optional[str] = None) -> int:
        if status:
            cursor = await self.db.execute(
                "SELECT COUNT(*) as cnt FROM trades WHERE status = ?", [status]
            )
        else:
            cursor = await self.db.execute("SELECT COUNT(*) as cnt FROM trades")
        row = await cursor.fetchone()
        return row["cnt"] if row else 0

    # --- Trade Memory ---

    async def insert_memory(self, memory: dict):
        cols = ", ".join(memory.keys())
        placeholders = ", ".join(["?"] * len(memory))
        values = [
            json.dumps(v) if isinstance(v, (dict, list)) else v
            for v in memory.values()
        ]
        await self.db.execute(
            f"INSERT INTO trade_memory ({cols}) VALUES ({placeholders})", values
        )
        await self.db.commit()

    async def find_similar_trades(
        self,
        pair: str,
        market_regime: str,
        limit: int = 5,
    ) -> list[dict]:
        # First try exact match (pair AND regime)
        cursor = await self.db.execute(
            """SELECT * FROM trade_memory
               WHERE pair = ? AND market_regime = ?
               ORDER BY created_at DESC LIMIT ?""",
            [pair, market_regime, limit],
        )
        rows = await cursor.fetchall()
        results = [dict(r) for r in rows]

        # If not enough, supplement with same pair (any regime)
        if len(results) < limit:
            remaining = limit - len(results)
            seen_ids = {r["id"] for r in results}
            cursor = await self.db.execute(
                """SELECT * FROM trade_memory
                   WHERE pair = ?
                   ORDER BY created_at DESC LIMIT ?""",
                [pair, remaining + 5],
            )
            rows = await cursor.fetchall()
            for r in rows:
                row = dict(r)
                if row["id"] not in seen_ids and len(results) < limit:
                    results.append(row)
                    seen_ids.add(row["id"])

        return results

    async def get_recent_memories(self, limit: int = 20) -> list[dict]:
        cursor = await self.db.execute(
            "SELECT * FROM trade_memory ORDER BY created_at DESC LIMIT ?", [limit]
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def update_memory_lesson(self, memory_id: int, lesson: str, tags: list[str]):
        await self.db.execute(
            "UPDATE trade_memory SET lesson_learned = ?, tags = ? WHERE id = ?",
            [lesson, json.dumps(tags), memory_id],
        )
        await self.db.commit()

    # --- Learned Rules ---

    async def insert_rule(self, rule: dict):
        cols = ", ".join(rule.keys())
        placeholders = ", ".join(["?"] * len(rule))
        values = [
            json.dumps(v) if isinstance(v, (dict, list)) else v
            for v in rule.values()
        ]
        await self.db.execute(
            f"INSERT INTO learned_rules ({cols}) VALUES ({placeholders})", values
        )
        await self.db.commit()

    async def get_active_rules(self) -> list[dict]:
        cursor = await self.db.execute(
            "SELECT * FROM learned_rules WHERE active = 1 ORDER BY confidence DESC"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def update_rule_stats(self, rule_id: int, successful: bool):
        if successful:
            await self.db.execute(
                """UPDATE learned_rules
                    SET times_applied = times_applied + 1,
                        times_successful = times_successful + 1,
                        updated_at = ?
                    WHERE id = ?""",
                [datetime.utcnow().isoformat(), rule_id],
            )
        else:
            await self.db.execute(
                """UPDATE learned_rules
                    SET times_applied = times_applied + 1,
                        updated_at = ?
                    WHERE id = ?""",
                [datetime.utcnow().isoformat(), rule_id],
            )
        await self.db.commit()

    async def deactivate_poor_rules(self, min_applied: int = 5, max_success_rate: float = 0.35):
        """Auto-deactivate rules with poor success rate."""
        cursor = await self.db.execute(
            """SELECT id, rule, times_applied, times_successful FROM learned_rules
               WHERE active = 1 AND times_applied >= ?""",
            [min_applied],
        )
        rows = await cursor.fetchall()
        deactivated = 0
        for r in rows:
            row = dict(r)
            rate = row["times_successful"] / row["times_applied"] if row["times_applied"] > 0 else 0
            if rate < max_success_rate:
                await self.db.execute(
                    "UPDATE learned_rules SET active = 0, updated_at = ? WHERE id = ?",
                    [datetime.utcnow().isoformat(), row["id"]],
                )
                deactivated += 1
                logger.info(f"Deactivated poor rule #{row['id']}: '{row['rule'][:50]}' ({rate:.0%} success)")
        if deactivated:
            await self.db.commit()
        return deactivated

    # --- Parameters ---

    async def insert_param_change(self, change: dict):
        cols = ", ".join(change.keys())
        placeholders = ", ".join(["?"] * len(change))
        values = [
            json.dumps(v) if isinstance(v, (dict, list)) else v
            for v in change.values()
        ]
        await self.db.execute(
            f"INSERT INTO parameters ({cols}) VALUES ({placeholders})", values
        )
        await self.db.commit()

    async def set_current_param(self, name: str, value: float):
        now = datetime.utcnow().isoformat()
        await self.db.execute(
            """INSERT INTO current_params (param_name, param_value, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(param_name) DO UPDATE SET param_value = ?, updated_at = ?""",
            [name, value, now, value, now],
        )
        await self.db.commit()

    async def get_current_params(self) -> dict[str, float]:
        cursor = await self.db.execute("SELECT * FROM current_params")
        rows = await cursor.fetchall()
        return {r["param_name"]: r["param_value"] for r in rows}

    async def get_param_history(self, param_name: Optional[str] = None, limit: int = 50) -> list[dict]:
        if param_name:
            cursor = await self.db.execute(
                "SELECT * FROM parameters WHERE param_name = ? ORDER BY created_at DESC LIMIT ?",
                [param_name, limit],
            )
        else:
            cursor = await self.db.execute(
                "SELECT * FROM parameters ORDER BY created_at DESC LIMIT ?", [limit]
            )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    # --- API Costs ---

    async def insert_api_cost(self, cost: dict):
        cols = ", ".join(cost.keys())
        placeholders = ", ".join(["?"] * len(cost))
        values = list(cost.values())
        await self.db.execute(
            f"INSERT INTO api_costs ({cols}) VALUES ({placeholders})", values
        )
        await self.db.commit()

    async def get_api_costs(
        self,
        service: Optional[str] = None,
        since: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict]:
        query = "SELECT * FROM api_costs WHERE 1=1"
        params: list = []
        if service:
            query += " AND service = ?"
            params.append(service)
        if since:
            query += " AND created_at >= ?"
            params.append(since)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        cursor = await self.db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def get_total_api_cost(self, since: Optional[str] = None) -> float:
        query = "SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_costs"
        params: list = []
        if since:
            query += " WHERE created_at >= ?"
            params.append(since)
        cursor = await self.db.execute(query, params)
        row = await cursor.fetchone()
        return row["total"] if row else 0.0

    async def get_costs_by_service(self, since: Optional[str] = None) -> list[dict]:
        query = """SELECT service, SUM(cost_usd) as total_cost,
                          SUM(tokens_in) as total_tokens_in,
                          SUM(tokens_out) as total_tokens_out,
                          COUNT(*) as call_count
                   FROM api_costs"""
        params: list = []
        if since:
            query += " WHERE created_at >= ?"
            params.append(since)
        query += " GROUP BY service"
        cursor = await self.db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    # --- Daily Stats ---

    async def upsert_daily_stats(self, stats: dict):
        cols = ", ".join(stats.keys())
        placeholders = ", ".join(["?"] * len(stats))
        updates = ", ".join([f"{k} = ?" for k in stats.keys() if k != "date"])
        values = list(stats.values())
        update_values = [v for k, v in stats.items() if k != "date"]
        await self.db.execute(
            f"""INSERT INTO daily_stats ({cols}) VALUES ({placeholders})
                ON CONFLICT(date) DO UPDATE SET {updates}""",
            values + update_values,
        )
        await self.db.commit()

    async def get_daily_stats(self, limit: int = 30) -> list[dict]:
        cursor = await self.db.execute(
            "SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?", [limit]
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def get_stats_range(self, start: str, end: str) -> list[dict]:
        cursor = await self.db.execute(
            "SELECT * FROM daily_stats WHERE date BETWEEN ? AND ? ORDER BY date",
            [start, end],
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
