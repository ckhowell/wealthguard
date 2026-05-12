#!/usr/bin/env python3
"""
WealthGuard API Server
Serves live market data and portfolio information
"""

import os
import json
import sqlite3
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Tuple

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Load environment
load_dotenv(Path(__file__).parent / '.env')

# Import yfinance for live price fetching
try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False
    logger = logging.getLogger('wealthguard-api')
    logger.warning("yfinance not available, market data will be mock")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('wealthguard-api')

# Database path — prefer DATABASE_PATH env var when the file exists,
# otherwise fall back to wealthguard.db next to this script (local dev).
_env_db = os.getenv('DATABASE_PATH', '')
_local_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wealthguard.db')
DB_PATH = _env_db if _env_db and os.path.exists(_env_db) else _local_db

# Initialize FastAPI
app = FastAPI(
    title="WealthGuard API",
    description="Live financial data API for WealthGuard",
    version="1.0.0"
)

# CORS configuration
origins = os.getenv('API_CORS_ORIGINS', 'http://localhost:5173').split(',')
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _run_startup_migrations():
    """Idempotent schema migrations run at boot. Safe to re-run."""
    try:
        with sqlite3.connect(DB_PATH) as conn:
            # Enable WAL so concurrent readers don't block writers.  Essential
            # because FastAPI runs sync endpoints in a thread-pool — a slow
            # Kimi-wrapped endpoint holding a write transaction was causing
            # "database is locked" errors against routine GETs.  Idempotent.
            try:
                conn.execute("PRAGMA journal_mode = WAL")
                conn.execute("PRAGMA busy_timeout = 5000")  # ms — retry briefly
                conn.commit()
            except sqlite3.Error as e:
                logger.warning(f"WAL migration skipped: {e}")

            conn.execute("""
                CREATE TABLE IF NOT EXISTS goals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    target_amount REAL NOT NULL,
                    target_date TEXT,
                    notes TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            # PodBits FTS fix (Phase 4.2): earlier schema used a bogus
            # `content_rowid='id'` syntax that prevents the virtual table from
            # rebuilding. Rebuild with `rowid=id` if we detect the old shape.
            user_version = conn.execute("PRAGMA user_version").fetchone()[0]
            if user_version < 1:
                try:
                    conn.executescript("""
                        DROP TABLE IF EXISTS podbits_search;
                        CREATE VIRTUAL TABLE IF NOT EXISTS podbits_search USING fts5(
                            title, summary, transcript,
                            content='podbits_episodes', content_rowid='id'
                        );
                        INSERT INTO podbits_search(rowid, title, summary, transcript)
                            SELECT id, title, COALESCE(summary, ''), COALESCE(transcript, '')
                            FROM podbits_episodes;
                        PRAGMA user_version = 1;
                    """)
                    logger.info("Applied PodBits FTS migration (user_version -> 1)")
                except sqlite3.Error as e:
                    logger.warning(f"PodBits FTS migration skipped: {e}")

            # Phase 6.2: tax-lot cost basis tracking.
            user_version = conn.execute("PRAGMA user_version").fetchone()[0]
            if user_version < 2:
                try:
                    conn.executescript("""
                        CREATE TABLE IF NOT EXISTS holding_lots (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            holding_id INTEGER NOT NULL,
                            shares REAL NOT NULL,
                            cost_per_share REAL NOT NULL,
                            purchase_date TEXT NOT NULL,
                            notes TEXT,
                            FOREIGN KEY(holding_id) REFERENCES holdings(id) ON DELETE CASCADE
                        );
                        CREATE INDEX IF NOT EXISTS idx_holding_lots_holding ON holding_lots(holding_id);
                        CREATE INDEX IF NOT EXISTS idx_holding_lots_purchase ON holding_lots(purchase_date);
                    """)
                    # Add transaction linkage columns only if they don't exist
                    cols = {r[1] for r in conn.execute("PRAGMA table_info(transactions)").fetchall()}
                    if 'holding_id' not in cols:
                        conn.execute("ALTER TABLE transactions ADD COLUMN holding_id INTEGER")
                    if 'lot_id' not in cols:
                        conn.execute("ALTER TABLE transactions ADD COLUMN lot_id INTEGER")

                    # Backfill one lot per existing holding.
                    existing = conn.execute(
                        "SELECT COUNT(*) FROM holding_lots"
                    ).fetchone()[0]
                    if existing == 0:
                        conn.execute("""
                            INSERT INTO holding_lots (holding_id, shares, cost_per_share, purchase_date, notes)
                            SELECT id,
                                   shares,
                                   COALESCE(cost_basis_per_share, 0),
                                   COALESCE(substr(last_price_update, 1, 10), date('now')),
                                   'backfilled from holdings'
                            FROM holdings
                            WHERE shares > 0
                        """)
                        logger.info("Backfilled holding_lots from holdings table")
                    conn.execute("PRAGMA user_version = 2")
                    logger.info("Applied tax-lots migration (user_version -> 2)")
                except sqlite3.Error as e:
                    logger.warning(f"Tax-lots migration skipped: {e}")

            # Phase 9: PodBits engagement (mark-as-listened, rating, notes).
            user_version = conn.execute("PRAGMA user_version").fetchone()[0]
            if user_version < 3:
                try:
                    cols = {r[1] for r in conn.execute("PRAGMA table_info(podbits_episodes)").fetchall()}
                    if 'is_listened' not in cols:
                        conn.execute("ALTER TABLE podbits_episodes ADD COLUMN is_listened INTEGER DEFAULT 0")
                    if 'listened_at' not in cols:
                        conn.execute("ALTER TABLE podbits_episodes ADD COLUMN listened_at TEXT")
                    if 'user_rating' not in cols:
                        conn.execute("ALTER TABLE podbits_episodes ADD COLUMN user_rating INTEGER")
                    if 'user_notes' not in cols:
                        conn.execute("ALTER TABLE podbits_episodes ADD COLUMN user_notes TEXT")
                    conn.execute("PRAGMA user_version = 3")
                    logger.info("Applied PodBits engagement migration (user_version -> 3)")
                except sqlite3.Error as e:
                    logger.warning(f"PodBits engagement migration skipped: {e}")

            # Phase 10: AI analyst layer on top of expert summaries.
            user_version = conn.execute("PRAGMA user_version").fetchone()[0]
            if user_version < 4:
                try:
                    cols = {r[1] for r in conn.execute("PRAGMA table_info(podbits_episodes)").fetchall()}
                    if 'ai_analysis' not in cols:
                        conn.execute("ALTER TABLE podbits_episodes ADD COLUMN ai_analysis TEXT")
                    if 'ai_analysis_at' not in cols:
                        conn.execute("ALTER TABLE podbits_episodes ADD COLUMN ai_analysis_at TEXT")
                    conn.execute("PRAGMA user_version = 4")
                    logger.info("Applied PodBits ai_analysis migration (user_version -> 4)")
                except sqlite3.Error as e:
                    logger.warning(f"PodBits ai_analysis migration skipped: {e}")

            # Phase 11: audio_url for Gemini audio-based summarization.
            user_version = conn.execute("PRAGMA user_version").fetchone()[0]
            if user_version < 5:
                try:
                    cols = {r[1] for r in conn.execute("PRAGMA table_info(podbits_episodes)").fetchall()}
                    if 'audio_url' not in cols:
                        conn.execute("ALTER TABLE podbits_episodes ADD COLUMN audio_url TEXT")
                    conn.execute("PRAGMA user_version = 5")
                    logger.info("Applied PodBits audio_url migration (user_version -> 5)")
                except sqlite3.Error as e:
                    logger.warning(f"PodBits audio_url migration skipped: {e}")

            # Phase 12: rebuke_log — accountability layer for the AI advisor.
            # Tracks when an opportunity was first surfaced + when (if ever) the
            # user dismissed or acted on it. Powers /api/intel/rebuke's ribbon
            # on the Dashboard. One row per (source_kind, source_ref) pair.
            user_version = conn.execute("PRAGMA user_version").fetchone()[0]
            if user_version < 6:
                try:
                    conn.executescript("""
                        CREATE TABLE IF NOT EXISTS rebuke_log (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            source_kind TEXT NOT NULL,
                            source_ref TEXT NOT NULL,
                            title TEXT NOT NULL,
                            opportunity_aud_per_mo REAL DEFAULT 0,
                            first_flagged TEXT NOT NULL,
                            last_rebuked TEXT,
                            dismissed_at TEXT,
                            dismissed_reason TEXT,
                            acted_at TEXT
                        );
                        CREATE UNIQUE INDEX IF NOT EXISTS idx_rebuke_source
                            ON rebuke_log(source_kind, source_ref);
                        CREATE INDEX IF NOT EXISTS idx_rebuke_active
                            ON rebuke_log(first_flagged)
                            WHERE dismissed_at IS NULL AND acted_at IS NULL;
                    """)
                    conn.execute("PRAGMA user_version = 6")
                    logger.info("Applied rebuke_log migration (user_version -> 6)")
                except sqlite3.Error as e:
                    logger.warning(f"rebuke_log migration skipped: {e}")
    except sqlite3.Error as e:
        logger.warning(f"Startup migration skipped: {e}")


@app.on_event("startup")
def _on_startup():
    _run_startup_migrations()

# Pydantic models
class Holding(BaseModel):
    id: int
    account_id: Optional[int] = None
    symbol: str
    asset_name: str
    shares: float
    current_price: Optional[float]
    cost_basis_per_share: Optional[float]
    asset_class: str
    sector: Optional[str]
    geography: Optional[str]
    last_price_update: Optional[str]
    native_currency: Optional[str] = None
    cost_basis_currency: Optional[str] = None
    value_usd: Optional[float] = None
    value_aud: Optional[float] = None
    cost_usd: Optional[float] = None
    cost_aud: Optional[float] = None
    # Legacy fields
    value_original: Optional[float] = None
    original_currency: Optional[str] = None


class HoldingIn(BaseModel):
    """Accepted by POST /api/holdings and PUT /api/holdings/{id}.

    For POST with kind='realEstate'|'vehicle', the server mints `symbol`
    (e.g. REAL_ESTATE_<id>) and defaults asset_class='alternative' when
    they aren't supplied. For PUT, any subset of fields is valid.
    """
    account_id: Optional[int] = None
    symbol: Optional[str] = None
    asset_name: Optional[str] = None
    shares: Optional[float] = None
    cost_basis_per_share: Optional[float] = None
    current_price: Optional[float] = None
    asset_class: Optional[str] = None
    sector: Optional[str] = None
    geography: Optional[str] = None
    native_currency: Optional[str] = None
    cost_basis_currency: Optional[str] = None
    kind: Optional[str] = None  # 'realEstate' | 'vehicle' | 'stock' | 'crypto'


class AccountOut(BaseModel):
    id: int
    name: str
    type: Optional[str] = None
    currency: Optional[str] = None
    institution: Optional[str] = None
    current_balance: Optional[float] = None
    apy: Optional[float] = None
    credit_limit: Optional[float] = None
    opened_date: Optional[str] = None
    is_active: Optional[int] = None
    created_at: Optional[str] = None


class AccountIn(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None  # 'savings'|'checking'|'credit'|'investment'
    currency: Optional[str] = None
    institution: Optional[str] = None
    current_balance: Optional[float] = None
    apy: Optional[float] = None

class PriceHistory(BaseModel):
    symbol: str
    price: float
    currency: str
    recorded_at: str

class MarketQuote(BaseModel):
    symbol: str
    name: str
    price: float
    change: float
    change_percent: float
    currency: str
    market_cap: Optional[float]
    volume: Optional[float]
    sector: str
    source: str

class PortfolioSummary(BaseModel):
    total_value: float
    total_cost: float
    total_gain_loss: float
    total_gain_loss_percent: float
    holdings_count: int
    last_updated: str


class GoalIn(BaseModel):
    name: str
    target_amount: float
    target_date: Optional[str] = None
    notes: Optional[str] = None


# Database helper
def get_db_connection():
    # 5-second busy_timeout makes SQLite retry on lock contention instead of
    # failing immediately.  Essential with WAL + FastAPI threadpool where a
    # Kimi-wrapped writer might briefly hold the write lock while readers
    # come in.  Matches the per-file pragma set in _run_startup_migrations.
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/")
def root():
    return {"status": "ok", "service": "WealthGuard API", "version": "1.0.0"}


# Optional shared-secret auth. Enabled only when WEALTHGUARD_PASSWORD is set.
# Skips on GET /, GET /api/health, and the Vite proxy's OPTIONS preflights.
from fastapi import Request
from fastapi.responses import JSONResponse, FileResponse

_AUTH_EXEMPT = {"/", "/api/health", "/docs", "/openapi.json", "/redoc"}


@app.middleware("http")
async def _password_gate(request: Request, call_next):
    password = os.getenv("WEALTHGUARD_PASSWORD")
    if not password:
        return await call_next(request)
    if request.method == "OPTIONS":
        return await call_next(request)
    if request.url.path in _AUTH_EXEMPT or not request.url.path.startswith("/api"):
        return await call_next(request)
    header = request.headers.get("x-wg-password") or request.query_params.get("wg_password")
    if header != password:
        return JSONResponse({"detail": "WG auth required"}, status_code=401)
    return await call_next(request)


@app.get("/api/health")
def get_health():
    """Lightweight health snapshot for the header badge + Settings page."""
    result: Dict = {
        "api": "ok",
        "database": "unknown",
        "last_sync": None,
        "providers": {},
        "checked_at": datetime.now().isoformat(),
    }
    try:
        with get_db_connection() as conn:
            conn.execute("SELECT 1").fetchone()
            result["database"] = "ok"
            sync = conn.execute(
                "SELECT started_at, completed_at, status, holdings_count, "
                "success_count, fail_count, duration_seconds, details "
                "FROM sync_runs ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if sync:
                result["last_sync"] = dict(sync)
    except sqlite3.Error as e:
        result["database"] = {"error": str(e)}

    provider_env_keys = {
        "kimi": "KIMI_API_KEY",
        "gemini": "GEMINI_API_KEY",
        "qwen": "QWEN_API_KEY",
        "openai": "OPENAI_API_KEY",
        "newsapi": "NEWSAPI_KEY",
        "gnews": "GNEWS_KEY",
        "alpha_vantage": "ALPHA_VANTAGE_API_KEY",
        "finnhub": "FINNHUB_API_KEY",
        "telegram": "TELEGRAM_BOT_TOKEN",
        "etherscan": "ETHERSCAN_API_KEY",
        "solscan": "SOLSCAN_API_KEY",
        "helius": "HELIUS_API_KEY",
    }
    for name, env_key in provider_env_keys.items():
        result["providers"][name] = "configured" if os.getenv(env_key) else "missing"
    result["whisper"] = "enabled" if os.getenv("WHISPER_ENABLED", "false").lower() in ("1", "true", "yes") else "disabled"
    result["auth"] = "password" if os.getenv("WEALTHGUARD_PASSWORD") else "open"
    return result


class ApiKeyIn(BaseModel):
    provider: str
    value: str


_API_KEY_PROVIDERS = {
    'gemini': 'GEMINI_API_KEY',
    'qwen': 'QWEN_API_KEY',
    'kimi': 'KIMI_API_KEY',
    'openai': 'OPENAI_API_KEY',
    'newsapi': 'NEWSAPI_KEY',
    'gnews': 'GNEWS_KEY',
    'finnhub': 'FINNHUB_API_KEY',
    'alpha_vantage': 'ALPHA_VANTAGE_API_KEY',
    'telegram': 'TELEGRAM_BOT_TOKEN',
    'etherscan': 'ETHERSCAN_API_KEY',
    'solscan': 'SOLSCAN_API_KEY',
    'helius': 'HELIUS_API_KEY',
}


def _env_file_path() -> Path:
    return Path(__file__).resolve().parent / '.env'


def _upsert_env_var(key: str, value: str) -> None:
    """Persist KEY=value in the repo-local .env file (in-place update)."""
    path = _env_file_path()
    lines: List[str] = []
    if path.exists():
        lines = path.read_text(encoding='utf-8').splitlines()
    replaced = False
    new_lines: List[str] = []
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith(f"{key}=") or stripped.startswith(f"export {key}="):
            new_lines.append(f"{key}={value}")
            replaced = True
        else:
            new_lines.append(line)
    if not replaced:
        new_lines.append(f"{key}={value}")
    path.write_text("\n".join(new_lines) + "\n", encoding='utf-8')


@app.post("/api/settings/api-key")
def set_api_key(body: ApiKeyIn):
    """Store an API key for a known provider. Writes to .env and updates the
    running process's environment so the change takes effect immediately."""
    env_key = _API_KEY_PROVIDERS.get(body.provider.lower())
    if not env_key:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {body.provider}")
    value = (body.value or '').strip()
    if not value:
        # Empty value clears the key.
        os.environ.pop(env_key, None)
    else:
        os.environ[env_key] = value
    try:
        _upsert_env_var(env_key, value)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not write .env: {e}")
    return {"ok": True, "provider": body.provider, "env_key": env_key, "configured": bool(value)}


class PriceAlertConfigIn(BaseModel):
    symbol: str
    alert_type: str  # 'percent_change' | 'threshold_high' | 'threshold_low'
    threshold_value: float
    is_active: bool = True


@app.get("/api/alerts/config")
def list_alert_configs(symbol: Optional[str] = None):
    """List configured price alerts. Filter by symbol when provided."""
    with get_db_connection() as conn:
        if symbol:
            rows = conn.execute(
                "SELECT id, symbol, alert_type, threshold_value, is_active, created_at "
                "FROM price_alert_config WHERE symbol = ? ORDER BY created_at DESC",
                (symbol.upper(),),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, symbol, alert_type, threshold_value, is_active, created_at "
                "FROM price_alert_config ORDER BY created_at DESC"
            ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/alerts/config")
def create_alert_config(alert: PriceAlertConfigIn):
    valid_types = {"percent_change", "threshold_high", "threshold_low"}
    if alert.alert_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"alert_type must be one of {valid_types}")
    with get_db_connection() as conn:
        cur = conn.execute(
            "INSERT INTO price_alert_config (symbol, alert_type, threshold_value, is_active) "
            "VALUES (?, ?, ?, ?)",
            (alert.symbol.upper(), alert.alert_type, alert.threshold_value, 1 if alert.is_active else 0),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, symbol, alert_type, threshold_value, is_active, created_at "
            "FROM price_alert_config WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
    return dict(row)


@app.delete("/api/alerts/config/{alert_id}")
def delete_alert_config(alert_id: int):
    with get_db_connection() as conn:
        cur = conn.execute("DELETE FROM price_alert_config WHERE id = ?", (alert_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Alert not found")
        conn.commit()
    return {"deleted": alert_id}


@app.get("/api/export/all")
def export_all():
    """Stream the raw SQLite DB file as a download. Read-only snapshot."""
    if not os.path.exists(DB_PATH):
        raise HTTPException(status_code=404, detail="Database not found")
    filename = f"wealthguard-{datetime.now().strftime('%Y-%m-%d')}.db"
    return FileResponse(
        path=DB_PATH,
        media_type="application/octet-stream",
        filename=filename,
    )


def _fx_cache() -> Tuple[Dict[Tuple[str, str], float], callable]:
    """Returns (cache_dict, fx_function) to share rate lookups across a request."""
    cache: Dict[Tuple[str, str], float] = {}
    def fx(src: str, dst: str) -> float:
        if src == dst:
            return 1.0
        key = (src, dst)
        if key not in cache:
            cache[key] = get_fx_rate(src, dst)
        return cache[key]
    return cache, fx


def _enrich_holding(row: dict, fx) -> dict:
    """Attach USD / AUD valuations to a holdings row. Row must have joined `account_currency`."""
    h = dict(row)
    shares = h.get('shares') or 0
    price = h.get('current_price') or 0
    cost = h.get('cost_basis_per_share') or 0
    native = (h.get('native_currency') or h.get('account_currency') or 'AUD').upper()
    cost_ccy = (h.get('cost_basis_currency') or native).upper()

    value_native = shares * price
    cost_native = shares * cost

    h['value_usd'] = value_native * fx(native, 'USD')
    h['value_aud'] = value_native * fx(native, 'AUD')
    h['cost_usd'] = cost_native * fx(cost_ccy, 'USD')
    h['cost_aud'] = cost_native * fx(cost_ccy, 'AUD')

    # Legacy fields (kept for any existing UI consumers).
    h['value_original'] = value_native
    h['original_currency'] = native
    return h


@app.get("/api/holdings", response_model=List[Holding])
def get_holdings():
    """Get all holdings with current prices plus USD and AUD valuations."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT h.*, a.currency as account_currency
            FROM holdings h
            JOIN accounts a ON h.account_id = a.id
            WHERE h.shares > 0
            ORDER BY h.shares * h.current_price DESC
        """)
        rows = cursor.fetchall()
        _, fx = _fx_cache()
        return [_enrich_holding(r, fx) for r in rows]


def _fetch_enriched_holding(conn, holding_id: int) -> Optional[dict]:
    row = conn.execute(
        "SELECT h.*, a.currency as account_currency "
        "FROM holdings h JOIN accounts a ON h.account_id = a.id "
        "WHERE h.id = ?",
        (holding_id,),
    ).fetchone()
    if not row:
        return None
    _, fx = _fx_cache()
    return _enrich_holding(row, fx)


_KIND_TO_ASSET_CLASS = {
    'realEstate': 'alternative',
    'vehicle': 'alternative',
    'stock': 'equity',
    'crypto': 'crypto',
}
_KIND_TO_SYMBOL_PREFIX = {
    'realEstate': 'REAL_ESTATE_',
    'vehicle': 'VEHICLE_',
}
_KIND_TO_DEFAULT_ACCOUNT = {
    'realEstate': 'Real Estate Holdings',
    'vehicle': 'Motor Vehicles',
    'crypto': 'Crypto Portfolio',
}


def _resolve_account_for_kind(conn, kind: Optional[str], supplied_id: Optional[int]) -> Optional[int]:
    if supplied_id:
        return supplied_id
    if kind and kind in _KIND_TO_DEFAULT_ACCOUNT:
        r = conn.execute("SELECT id FROM accounts WHERE name = ?", (_KIND_TO_DEFAULT_ACCOUNT[kind],)).fetchone()
        if r:
            return r['id']
    return None


@app.post("/api/holdings")
def create_holding(payload: HoldingIn):
    """Create a holding. If `kind` is realEstate/vehicle, symbol + asset_class are auto-assigned."""
    with get_db_connection() as conn:
        account_id = _resolve_account_for_kind(conn, payload.kind, payload.account_id)
        if not account_id:
            raise HTTPException(status_code=400, detail="account_id or a known kind is required")

        asset_class = payload.asset_class or (_KIND_TO_ASSET_CLASS.get(payload.kind or '') if payload.kind else None)
        if not asset_class:
            raise HTTPException(status_code=400, detail="asset_class or kind is required")

        shares = payload.shares if payload.shares is not None else 1.0
        current_price = payload.current_price
        cost_basis = payload.cost_basis_per_share if payload.cost_basis_per_share is not None else current_price

        native_ccy = (payload.native_currency or '').upper() or None
        cost_ccy = (payload.cost_basis_currency or native_ccy or '').upper() or None

        symbol = payload.symbol
        if not symbol and payload.kind in _KIND_TO_SYMBOL_PREFIX:
            # Mint a fresh prefix_<N> symbol.
            prefix = _KIND_TO_SYMBOL_PREFIX[payload.kind]
            r = conn.execute(
                "SELECT COALESCE(MAX(CAST(substr(symbol, ?) AS INTEGER)), 0) + 1 AS nxt "
                "FROM holdings WHERE symbol LIKE ?",
                (len(prefix) + 1, prefix + '%'),
            ).fetchone()
            symbol = f"{prefix}{r['nxt']}"
        if not symbol:
            raise HTTPException(status_code=400, detail="symbol or kind is required")

        cur = conn.execute(
            """INSERT INTO holdings
               (account_id, symbol, asset_name, shares, cost_basis_per_share, current_price,
                asset_class, sector, geography, native_currency, cost_basis_currency)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                account_id, symbol, payload.asset_name or symbol, shares,
                cost_basis, current_price, asset_class,
                payload.sector, payload.geography, native_ccy, cost_ccy,
            ),
        )
        conn.commit()
        result = _fetch_enriched_holding(conn, cur.lastrowid)
        if not result:
            raise HTTPException(status_code=500, detail="Insert succeeded but row missing")
        return result


@app.put("/api/holdings/{holding_id}")
def update_holding(holding_id: int, payload: HoldingIn):
    """Patch a holding. Only fields present in the body are updated."""
    fields = {
        'account_id': payload.account_id,
        'symbol': payload.symbol,
        'asset_name': payload.asset_name,
        'shares': payload.shares,
        'cost_basis_per_share': payload.cost_basis_per_share,
        'current_price': payload.current_price,
        'asset_class': payload.asset_class,
        'sector': payload.sector,
        'geography': payload.geography,
        'native_currency': (payload.native_currency or '').upper() or None if payload.native_currency is not None else None,
        'cost_basis_currency': (payload.cost_basis_currency or '').upper() or None if payload.cost_basis_currency is not None else None,
    }
    set_clauses = [f"{k} = ?" for k, v in fields.items() if v is not None]
    if not set_clauses:
        raise HTTPException(status_code=400, detail="No updatable fields supplied")
    values = [v for v in fields.values() if v is not None]
    values.append(holding_id)

    with get_db_connection() as conn:
        cur = conn.execute(
            f"UPDATE holdings SET {', '.join(set_clauses)} WHERE id = ?",
            values,
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Holding not found")
        conn.commit()
        result = _fetch_enriched_holding(conn, holding_id)
        if not result:
            raise HTTPException(status_code=404, detail="Holding not found after update")
        return result


@app.delete("/api/holdings/{holding_id}")
def delete_holding(holding_id: int, cascade: bool = False):
    """Delete a holding and its lots. If `cascade=true`, also deletes linked
    transactions; otherwise returns 409 when any transaction references it."""
    with get_db_connection() as conn:
        h = conn.execute("SELECT id FROM holdings WHERE id = ?", (holding_id,)).fetchone()
        if not h:
            raise HTTPException(status_code=404, detail="Holding not found")
        txn_count = conn.execute(
            "SELECT COUNT(*) AS n FROM transactions WHERE holding_id = ?", (holding_id,)
        ).fetchone()['n']
        if txn_count > 0 and not cascade:
            raise HTTPException(
                status_code=409,
                detail=f"{txn_count} transaction(s) reference this holding. Pass cascade=true to delete them too.",
            )
        if cascade:
            conn.execute("DELETE FROM transactions WHERE holding_id = ?", (holding_id,))
        conn.execute("DELETE FROM holding_lots WHERE holding_id = ?", (holding_id,))
        conn.execute("DELETE FROM holdings WHERE id = ?", (holding_id,))
        conn.commit()
        return {"deleted": holding_id, "transactions_deleted": txn_count if cascade else 0}


@app.get("/api/holdings/{symbol}")
def get_holding(symbol: str):
    """Get specific holding details"""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT h.*, a.name as account_name, a.currency as account_currency
            FROM holdings h
            JOIN accounts a ON h.account_id = a.id
            WHERE h.symbol = ? AND h.shares > 0
        """, (symbol.upper(),))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Holding not found")
        return dict(row)


@app.get("/api/portfolio/summary")
def get_portfolio_summary():
    """Get portfolio summary with P&L, totals in both AUD and USD."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT h.shares, h.current_price, h.cost_basis_per_share,
                   h.native_currency, h.cost_basis_currency,
                   h.last_price_update, a.currency AS account_currency
            FROM holdings h
            JOIN accounts a ON h.account_id = a.id
            WHERE h.shares > 0
        """)
        rows = cursor.fetchall()

        fx_cache: Dict[Tuple[str, str], float] = {}
        def fx(src: str, dst: str) -> float:
            if src == dst:
                return 1.0
            key = (src, dst)
            if key not in fx_cache:
                fx_cache[key] = get_fx_rate(src, dst)
            return fx_cache[key]

        total_value_aud = total_value_usd = 0.0
        total_cost_aud = total_cost_usd = 0.0
        last_updated = None
        for r in rows:
            shares = r['shares'] or 0
            price = r['current_price'] or 0
            cost = r['cost_basis_per_share'] or 0
            native = (r['native_currency'] or r['account_currency'] or 'AUD').upper()
            cost_ccy = (r['cost_basis_currency'] or native).upper()
            val_native = shares * price
            cost_native = shares * cost
            total_value_aud += val_native * fx(native, 'AUD')
            total_value_usd += val_native * fx(native, 'USD')
            total_cost_aud += cost_native * fx(cost_ccy, 'AUD')
            total_cost_usd += cost_native * fx(cost_ccy, 'USD')
            if r['last_price_update'] and (last_updated is None or r['last_price_update'] > last_updated):
                last_updated = r['last_price_update']

        if not rows:
            return {
                "total_value": 0, "total_cost": 0,
                "total_value_aud": 0, "total_value_usd": 0,
                "total_cost_aud": 0, "total_cost_usd": 0,
                "total_gain_loss": 0, "total_gain_loss_percent": 0,
                "holdings_count": 0, "last_updated": None,
            }

        gain_aud = total_value_aud - total_cost_aud
        gain_pct_aud = (gain_aud / total_cost_aud * 100) if total_cost_aud > 0 else 0

        return {
            # Primary totals are AUD (user's base currency).
            "total_value": round(total_value_aud, 2),
            "total_cost": round(total_cost_aud, 2),
            "total_gain_loss": round(gain_aud, 2),
            "total_gain_loss_percent": round(gain_pct_aud, 2),
            "total_value_aud": round(total_value_aud, 2),
            "total_value_usd": round(total_value_usd, 2),
            "total_cost_aud": round(total_cost_aud, 2),
            "total_cost_usd": round(total_cost_usd, 2),
            "holdings_count": len(rows),
            "last_updated": last_updated,
        }


@app.get("/api/prices/history/{symbol}")
def get_price_history(symbol: str, days: int = 30):
    """Get price history for a symbol"""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT symbol, price, currency, recorded_at
            FROM price_history
            WHERE symbol = ?
              AND recorded_at >= datetime('now', '-{} days')
            ORDER BY recorded_at ASC
        """.format(days), (symbol.upper(),))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


# Market data endpoints (pre-configured popular symbols)
import random

US_STOCKS = [
    {"symbol": "AAPL", "name": "Apple Inc.", "sector": "Technology"},
    {"symbol": "MSFT", "name": "Microsoft", "sector": "Technology"},
    {"symbol": "NVDA", "name": "NVIDIA", "sector": "Technology"},
    {"symbol": "GOOGL", "name": "Alphabet", "sector": "Technology"},
    {"symbol": "AMZN", "name": "Amazon", "sector": "Consumer"},
    {"symbol": "META", "name": "Meta", "sector": "Technology"},
    {"symbol": "TSLA", "name": "Tesla", "sector": "Consumer"},
    {"symbol": "BRK.B", "name": "Berkshire", "sector": "Financials"},
    {"symbol": "JPM", "name": "JPMorgan", "sector": "Financials"},
    {"symbol": "V", "name": "Visa", "sector": "Financials"},
]

ASX_STOCKS = [
    {"symbol": "CBA.AX", "name": "Commonwealth Bank", "sector": "Financials"},
    {"symbol": "BHP.AX", "name": "BHP Group", "sector": "Materials"},
    {"symbol": "RIO.AX", "name": "Rio Tinto", "sector": "Materials"},
    {"symbol": "NAB.AX", "name": "NAB", "sector": "Financials"},
    {"symbol": "WBC.AX", "name": "Westpac", "sector": "Financials"},
    {"symbol": "ANZ.AX", "name": "ANZ Bank", "sector": "Financials"},
    {"symbol": "WES.AX", "name": "Wesfarmers", "sector": "Consumer"},
    {"symbol": "WOW.AX", "name": "Woolworths", "sector": "Consumer"},
    {"symbol": "TLS.AX", "name": "Telstra", "sector": "Telecom"},
    {"symbol": "CSL.AX", "name": "CSL Limited", "sector": "Healthcare"},
    {"symbol": "TCL.AX", "name": "Transurban Group", "sector": "Infrastructure"},
    {"symbol": "VAS.AX", "name": "Vanguard Australian Shares ETF", "sector": "ETF"},
]

CN_STOCKS = [
    {"symbol": "600519.SS", "name": "Kweichow Moutai", "sector": "Consumer Staples"},
    {"symbol": "601318.SS", "name": "Ping An Insurance", "sector": "Financials"},
    {"symbol": "600036.SS", "name": "China Merchants Bank", "sector": "Financials"},
    {"symbol": "300750.SZ", "name": "CATL", "sector": "Technology"},
    {"symbol": "601888.SS", "name": "China Tourism", "sector": "Consumer"},
]

CRYPTO_SYMBOLS = [
    {"symbol": "BTC", "name": "Bitcoin", "sector": "Crypto"},
    {"symbol": "ETH", "name": "Ethereum", "sector": "Crypto"},
    {"symbol": "SOL", "name": "Solana", "sector": "Crypto"},
    {"symbol": "XRP", "name": "XRP", "sector": "Crypto"},
    {"symbol": "SUI", "name": "Sui", "sector": "Crypto"},
]

# Hardcoded FX fallback used only when the fx_rates table is empty for a pair.
FX_RATES_FALLBACK = {
    'USD/AUD': 1.55,
    'AUD/USD': 0.645,
    'AUD/JPY': 109.89,
    'JPY/AUD': 0.009117,
}


def _fx_from_db(from_curr: str, to_curr: str) -> Optional[float]:
    try:
        with get_db_connection() as conn:
            row = conn.execute(
                """
                SELECT rate FROM fx_rates
                WHERE from_currency = ? AND to_currency = ?
                ORDER BY recorded_at DESC LIMIT 1
                """,
                (from_curr, to_curr),
            ).fetchone()
            if row and row['rate']:
                return float(row['rate'])
            inv = conn.execute(
                """
                SELECT rate FROM fx_rates
                WHERE from_currency = ? AND to_currency = ?
                ORDER BY recorded_at DESC LIMIT 1
                """,
                (to_curr, from_curr),
            ).fetchone()
            if inv and inv['rate']:
                return 1.0 / float(inv['rate'])
    except sqlite3.Error:
        pass
    return None


def get_fx_rate(from_curr: str, to_curr: str) -> float:
    """Latest live rate from the fx_rates table; falls back to a static map."""
    if from_curr == to_curr:
        return 1.0
    live = _fx_from_db(from_curr, to_curr)
    if live is not None:
        return live
    pair = f"{from_curr}/{to_curr}"
    if pair in FX_RATES_FALLBACK:
        return FX_RATES_FALLBACK[pair]
    inverse = f"{to_curr}/{from_curr}"
    if inverse in FX_RATES_FALLBACK:
        return 1 / FX_RATES_FALLBACK[inverse]
    return 1.0


def fetch_live_price(symbol: str) -> Optional[Dict]:
    """Fetch live price using yfinance"""
    if not YFINANCE_AVAILABLE:
        return None
    
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        
        if not info:
            return None
        
        price = info.get('regularMarketPrice') or info.get('previousClose')
        if not price:
            return None
        
        # Get change percent if available
        change_pct = info.get('regularMarketChangePercent')
        if change_pct is None:
            prev_close = info.get('previousClose')
            if prev_close and prev_close > 0:
                change_pct = ((price - prev_close) / prev_close) * 100
            else:
                change_pct = 0
        
        return {
            'price': price,
            'change_percent': change_pct,
            'currency': info.get('currency', 'USD'),
            'name': info.get('shortName') or info.get('longName')
        }
    except Exception as e:
        logger.debug(f"yfinance failed for {symbol}: {e}")
        return None


@app.get("/api/markets/{region}")
def get_market_data(region: str):
    """Get market data for a region (US, AU, CN, CRYPTO)"""
    region = region.upper()
    
    if region == "US":
        stocks = US_STOCKS
    elif region == "AU":
        stocks = ASX_STOCKS
    elif region == "CN":
        stocks = CN_STOCKS
    elif region == "CRYPTO":
        stocks = CRYPTO_SYMBOLS
    else:
        raise HTTPException(status_code=400, detail="Invalid region. Use US, AU, CN, or CRYPTO")
    
    # Get latest prices from database if available
    with get_db_connection() as conn:
        cursor = conn.cursor()
        symbols = [s["symbol"] for s in stocks]
        placeholders = ','.join('?' * len(symbols))
        
        cursor.execute(f"""
            SELECT symbol, current_price as price, last_price_update as updated
            FROM holdings
            WHERE symbol IN ({placeholders})
            UNION
            SELECT symbol, price, recorded_at as updated
            FROM price_history
            WHERE symbol IN ({placeholders})
            AND recorded_at = (
                SELECT MAX(recorded_at) 
                FROM price_history ph2 
                WHERE ph2.symbol = price_history.symbol
            )
        """, symbols + symbols)
        
        price_map = {row['symbol']: dict(row) for row in cursor.fetchall()}
    
    # Build response with fallback to live fetch, then mock data
    result = []
    for stock in stocks:
        symbol = stock["symbol"]
        price_info = price_map.get(symbol, {})
        
        price = price_info.get('price')
        change_pct = None
        source = "live"  # Database prices are live (regularly updated)
        fetched_name = None
        
        if price is None:
            # Try to fetch live price
            live_data = fetch_live_price(symbol)
            if live_data:
                price = live_data['price']
                change_pct = live_data['change_percent']
                fetched_name = live_data.get('name')
                source = "live"
                logger.info(f"Fetched live price for {symbol}: ${price}")
            else:
                # Fallback: generate reasonable mock price
                base = 100 + random.random() * 400
                change_pct = (random.random() - 0.5) * 4
                price = base
                source = "mock"
        
        if change_pct is None:
            change_pct = (random.random() - 0.5) * 4
        
        change = price * (change_pct / 100)
        
        currency = "USD" if region in ["US", "CRYPTO"] else ("AUD" if region == "AU" else "CNY")
        
        # Calculate AUD price for US stocks
        aud_price = None
        if region == "US":
            aud_price = round(price * get_fx_rate("USD", "AUD"), 2)
        elif region == "CRYPTO":
            aud_price = round(price * get_fx_rate("USD", "AUD"), 2)
        
        result.append({
            "symbol": symbol,
            "name": fetched_name or stock["name"],
            "price": round(price, 2),
            "price_aud": aud_price,
            "change": round(change, 2),
            "change_percent": round(change_pct, 2),
            "currency": currency,
            "sector": stock["sector"],
            "market_cap": None,
            "volume": None,
            "source": source
        })
    
    return {
        "region": region,
        "count": len(result),
        "updated_at": datetime.now().isoformat(),
        "quotes": result
    }


@app.get("/api/fx-rates")
def get_fx_rates():
    """Get latest FX rates"""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT from_currency, to_currency, rate, recorded_at
            FROM fx_rates
            WHERE recorded_at >= datetime('now', '-1 day')
            ORDER BY recorded_at DESC
        """)
        rows = cursor.fetchall()
        
        # Deduplicate by currency pair
        seen = set()
        rates = []
        for row in rows:
            pair = (row['from_currency'], row['to_currency'])
            if pair not in seen:
                seen.add(pair)
                rates.append(dict(row))
        
        return {
            "rates": rates,
            "default_fallback": {
                "USD/AUD": 1.55,
                "AUD/USD": 0.645,
                "AUD/JPY": 109.89
            }
        }


@app.get("/api/fx-rates/latest")
def get_fx_rate_latest(from_: str = "USD", to: str = "AUD"):
    """Latest rate for a single currency pair. Query params: from, to."""
    from_curr = from_.upper()
    to_curr = to.upper()
    rate = get_fx_rate(from_curr, to_curr)
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT recorded_at, source FROM fx_rates "
            "WHERE from_currency = ? AND to_currency = ? "
            "ORDER BY recorded_at DESC LIMIT 1",
            (from_curr, to_curr),
        ).fetchone()
    return {
        "from_currency": from_curr,
        "to_currency": to_curr,
        "rate": rate,
        "recorded_at": row["recorded_at"] if row else None,
        "source": row["source"] if row else "fallback",
    }


# ============================================================================
# Dashboard cockpit — consolidated live snapshots
# ============================================================================
_MARKETS_SNAPSHOT_CACHE: Dict[str, object] = {'t': 0.0, 'data': None}

@app.get("/api/dashboard/markets-snapshot")
def api_markets_snapshot():
    """Tiny consolidated snapshot used by the Dashboard cockpit.

    Returns FX pairs (AUD/USD, AUD/JPY) with 24h change and top crypto
    prices (BTC/ETH/SOL/SUI/XRP) with 24h change, all in AUD.  60s cache.
    """
    import time as _time
    now = _time.time()
    cached = _MARKETS_SNAPSHOT_CACHE.get('data')
    ts = _MARKETS_SNAPSHOT_CACHE.get('t') or 0
    if cached and (now - ts) < 60:
        return cached

    _, fx = _fx_cache()
    out_fx: List[Dict] = []
    out_crypto: List[Dict] = []

    try:
        # --- FX: current + ~24h-prior rate from fx_rates table ----------------
        with get_db_connection() as conn:
            for base, quote in (('AUD', 'USD'), ('AUD', 'JPY')):
                cur = fx(base, quote)
                prior_row = conn.execute(
                    """SELECT rate FROM fx_rates
                       WHERE from_currency = ? AND to_currency = ?
                         AND recorded_at <= datetime('now', '-20 hours')
                       ORDER BY recorded_at DESC LIMIT 1""",
                    (base, quote),
                ).fetchone()
                prior = prior_row['rate'] if prior_row else cur
                change = ((cur - prior) / prior * 100) if prior else 0
                out_fx.append({
                    'pair': f'{base}/{quote}',
                    'rate': round(cur, 4 if quote != 'JPY' else 2),
                    'change_pct': round(change, 2),
                })

            # --- Crypto: current price from holdings + ~24h price from price_history
            crypto_symbols = ['BTC', 'ETH', 'SOL', 'SUI', 'XRP']
            for sym in crypto_symbols:
                h = conn.execute(
                    """SELECT current_price, native_currency
                       FROM holdings WHERE UPPER(symbol) = ? AND asset_class = 'crypto'
                       LIMIT 1""",
                    (sym,),
                ).fetchone()
                if not h or not h['current_price']:
                    continue
                native = (h['native_currency'] or 'USD').upper()
                price_native = h['current_price']
                price_aud = price_native * fx(native, 'AUD')

                prior_row = conn.execute(
                    """SELECT price FROM price_history
                       WHERE UPPER(symbol) = ?
                         AND recorded_at <= datetime('now', '-20 hours')
                       ORDER BY recorded_at DESC LIMIT 1""",
                    (sym,),
                ).fetchone()
                prior = prior_row['price'] if prior_row else price_native
                change_24h = ((price_native - prior) / prior * 100) if prior else 0

                out_crypto.append({
                    'symbol': sym,
                    'price_native': round(price_native, 4 if price_native < 10 else 2),
                    'native_currency': native,
                    'price_aud': round(price_aud, 2),
                    'change_24h_pct': round(change_24h, 2),
                })
    except Exception as e:
        logger.warning(f"markets snapshot failed: {e}")

    data = {
        'fx': out_fx,
        'crypto': out_crypto,
        'updated_at': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
    }
    _MARKETS_SNAPSHOT_CACHE['t'] = now
    _MARKETS_SNAPSHOT_CACHE['data'] = data
    return data


@app.get("/api/runway/delta")
def api_runway_delta(days: int = 7):
    """Compare current runway to N days ago to show 'Δ this week' on the cockpit.

    Uses `net_worth_history` cash snapshots and current baseline burn.
    """
    try:
        with get_db_connection() as conn:
            # Today (latest snapshot) and N days ago.  Schema: `cash_value`.
            today_row = conn.execute(
                "SELECT cash_value, snapshot_date FROM net_worth_history "
                "ORDER BY snapshot_date DESC LIMIT 1"
            ).fetchone()
            prior_row = conn.execute(
                "SELECT cash_value, snapshot_date FROM net_worth_history "
                "WHERE snapshot_date <= date('now', ?) "
                "ORDER BY snapshot_date DESC LIMIT 1",
                (f'-{max(1, int(days))} days',),
            ).fetchone()

            # Use current baseline burn (fallback to 0)
            runway = api_advisor_runway(months_back=12, living_window=3)
            burn = (runway.get('runway') or {}).get('baseline_net_burn_per_month') or 0

        current_cash = (today_row['cash_value'] if today_row else 0) or 0
        prior_cash   = (prior_row['cash_value'] if prior_row else current_cash) or current_cash

        def _months(cash: float) -> Optional[float]:
            if burn <= 0 or cash <= 0:
                return None
            return round(cash / burn, 1)

        current_months = _months(current_cash)
        prior_months   = _months(prior_cash)
        delta_months   = None
        if current_months is not None and prior_months is not None:
            delta_months = round(current_months - prior_months, 1)

        cash_delta = current_cash - prior_cash
        cause = ''
        if cash_delta < -500:
            cause = f'cash drew down ${abs(cash_delta):,.0f}'
        elif cash_delta > 500:
            cause = f'cash grew ${cash_delta:,.0f}'
        elif burn <= 0:
            cause = 'income covers burn'
        else:
            cause = 'stable'

        return {
            'current_months': current_months,
            'prior_months': prior_months,
            'delta_months': delta_months,
            'current_cash_aud': round(current_cash, 2),
            'prior_cash_aud': round(prior_cash, 2),
            'cash_delta_aud': round(cash_delta, 2),
            'days_back': days,
            'cause': cause,
        }
    except Exception as e:
        logger.warning(f"runway delta failed: {e}")
        return {
            'current_months': None, 'prior_months': None, 'delta_months': None,
            'current_cash_aud': 0, 'prior_cash_aud': 0, 'cash_delta_aud': 0,
            'days_back': days, 'cause': f'error: {e}',
        }


@app.get("/api/tax/report")
def get_tax_report(year: Optional[int] = None, fy: str = "calendar"):
    """
    Realized + unrealized gains for a given year.

    `fy=calendar` → Jan 1 – Dec 31 (default).
    `fy=au`       → Jul 1 – Jun 30 (Australian financial year; `year` is the end year).
    """
    today = datetime.now().date()
    if year is None:
        year = today.year
    if fy == "au":
        start_date = f"{year - 1}-07-01"
        end_date = f"{year}-06-30"
    else:
        start_date = f"{year}-01-01"
        end_date = f"{year}-12-31"

    realized: List[Dict] = []
    unrealized: List[Dict] = []

    with get_db_connection() as conn:
        # --- Realized: sell-type transactions (amount treated as total proceeds). ---
        # Sell transactions are tagged either via holding_id linkage or
        # via payee containing the symbol. Conservative: only realize when
        # holding_id is populated.
        sells = conn.execute(
            """
            SELECT t.id AS txn_id, t.transaction_date, t.amount, t.holding_id,
                   h.symbol, h.asset_class
            FROM transactions t
            JOIN holdings h ON h.id = t.holding_id
            WHERE t.transaction_type = 'debit'
              AND t.holding_id IS NOT NULL
              AND t.transaction_date BETWEEN ? AND ?
            ORDER BY t.transaction_date ASC, t.id ASC
            """,
            (start_date, end_date),
        ).fetchall()

        for sell in sells:
            # FIFO match against oldest open lots for this holding.
            lots = conn.execute(
                """
                SELECT id, shares, cost_per_share, purchase_date
                FROM holding_lots
                WHERE holding_id = ?
                ORDER BY purchase_date ASC, id ASC
                """,
                (sell["holding_id"],),
            ).fetchall()
            # Convention: `amount` is proceeds. Match by proceeds vs shares is
            # messy; we assume the sell record carries the number of shares in
            # its `amount` column for now (a pragmatic choice until a
            # shares-sold column is added). Fall back to treating amount as
            # proceeds and matching against the first lot's cost_per_share.
            remaining_shares = float(sell["amount"] or 0)
            if remaining_shares <= 0:
                continue
            for lot in lots:
                if remaining_shares <= 0:
                    break
                take = min(remaining_shares, float(lot["shares"] or 0))
                if take <= 0:
                    continue
                cost_per = float(lot["cost_per_share"] or 0)
                # Proceeds per share unknown — approximate via current_price at sell date.
                proceeds_per = cost_per  # placeholder; see note below
                gain = (proceeds_per - cost_per) * take
                realized.append({
                    "txn_id": sell["txn_id"],
                    "symbol": sell["symbol"],
                    "sold_on": sell["transaction_date"],
                    "shares": round(take, 6),
                    "cost_per_share": round(cost_per, 4),
                    "proceeds_per_share": round(proceeds_per, 4),
                    "cost_basis": round(cost_per * take, 2),
                    "proceeds": round(proceeds_per * take, 2),
                    "gain": round(gain, 2),
                    "lot_id": lot["id"],
                    "note": "proceeds not recorded — gain approximated as 0",
                })
                remaining_shares -= take

        # --- Unrealized: current holdings valued at latest price. ---
        open_lots = conn.execute(
            """
            SELECT hl.id AS lot_id, hl.shares, hl.cost_per_share, hl.purchase_date,
                   h.symbol, h.current_price, h.asset_class
            FROM holding_lots hl
            JOIN holdings h ON h.id = hl.holding_id
            WHERE hl.shares > 0
            """
        ).fetchall()
        for lot in open_lots:
            cur = float(lot["current_price"] or 0)
            cps = float(lot["cost_per_share"] or 0)
            shares = float(lot["shares"] or 0)
            gain = (cur - cps) * shares
            unrealized.append({
                "lot_id": lot["lot_id"],
                "symbol": lot["symbol"],
                "purchase_date": lot["purchase_date"],
                "shares": round(shares, 6),
                "cost_per_share": round(cps, 4),
                "current_price": round(cur, 4),
                "cost_basis": round(cps * shares, 2),
                "market_value": round(cur * shares, 2),
                "gain": round(gain, 2),
                "holding_period_days": max(
                    0,
                    (today - datetime.fromisoformat(lot["purchase_date"]).date()).days,
                ),
            })

    total_realized = round(sum(r["gain"] for r in realized), 2)
    total_unrealized = round(sum(u["gain"] for u in unrealized), 2)
    return {
        "year": year,
        "fy": fy,
        "fy_start": start_date,
        "fy_end": end_date,
        "realized": realized,
        "unrealized": unrealized,
        "total_realized": total_realized,
        "total_unrealized": total_unrealized,
        "note": "Sell proceeds aren't yet captured per-transaction; realized gains above treat sells as cost-basis-neutral placeholders. Import CSVs that distinguish sell proceeds to populate this fully.",
    }


@app.get("/api/performance")
def get_performance(period: str = "1Y", benchmark: Optional[str] = None):
    """Portfolio TWR / IRR / drawdown / volatility + optional benchmark overlay."""
    try:
        from wealthguard_performance import compute_performance
        return compute_performance(period=period.upper(), benchmark=benchmark)
    except Exception as e:
        logger.exception("Performance error")
        raise HTTPException(status_code=500, detail=f"Performance compute failed: {e}")


@app.get("/api/net-worth/history")
def get_net_worth_history(days: int = 180):
    """Net worth snapshots from net_worth_history, ascending by date."""
    days = max(1, min(days, 3650))
    with get_db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT snapshot_date, net_worth, total_assets, total_liabilities,
                   investment_value, cash_value
            FROM net_worth_history
            WHERE snapshot_date >= date('now', '-{days} days')
            ORDER BY snapshot_date ASC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def _enrich_account(row: dict) -> dict:
    a = dict(row)
    cur = a.get('currency') or 'AUD'
    balance = a.get('current_balance') or 0
    a['current_balance_aud'] = balance * get_fx_rate(cur, 'AUD')
    return a


@app.get("/api/accounts")
def get_accounts():
    """All active accounts with AUD-equivalent balances."""
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, name, type, currency, current_balance, credit_limit,
                   institution, opened_date, is_active, apy
            FROM accounts
            WHERE is_active = 1
            ORDER BY type, name
            """
        ).fetchall()
    return [_enrich_account(r) for r in rows]


def _fetch_account(conn, account_id: int) -> Optional[dict]:
    row = conn.execute(
        """
        SELECT id, name, type, currency, current_balance, credit_limit,
               institution, opened_date, is_active, apy
        FROM accounts WHERE id = ?
        """,
        (account_id,),
    ).fetchone()
    return _enrich_account(row) if row else None


@app.post("/api/accounts")
def create_account(payload: AccountIn):
    if not payload.name or not payload.type:
        raise HTTPException(status_code=400, detail="name and type are required")
    with get_db_connection() as conn:
        cur = conn.execute(
            """INSERT INTO accounts (name, type, currency, institution, current_balance, apy, is_active)
               VALUES (?, ?, ?, ?, ?, ?, 1)""",
            (
                payload.name, payload.type, (payload.currency or 'AUD').upper(),
                payload.institution, payload.current_balance or 0, payload.apy,
            ),
        )
        conn.commit()
        result = _fetch_account(conn, cur.lastrowid)
        if not result:
            raise HTTPException(status_code=500, detail="Insert succeeded but row missing")
        return result


@app.put("/api/accounts/{account_id}")
def update_account(account_id: int, payload: AccountIn):
    fields = {
        'name': payload.name,
        'currency': payload.currency.upper() if payload.currency else None,
        'institution': payload.institution,
        'current_balance': payload.current_balance,
        'apy': payload.apy,
    }
    set_clauses = [f"{k} = ?" for k, v in fields.items() if v is not None]
    if not set_clauses:
        raise HTTPException(status_code=400, detail="No updatable fields supplied")
    values = [v for v in fields.values() if v is not None]
    values.append(account_id)

    with get_db_connection() as conn:
        cur = conn.execute(
            f"UPDATE accounts SET {', '.join(set_clauses)} WHERE id = ?",
            values,
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Account not found")
        conn.commit()
        result = _fetch_account(conn, account_id)
        if not result:
            raise HTTPException(status_code=404, detail="Account not found after update")
        return result


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: int):
    with get_db_connection() as conn:
        a = conn.execute("SELECT id FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if not a:
            raise HTTPException(status_code=404, detail="Account not found")
        n_hold = conn.execute(
            "SELECT COUNT(*) AS n FROM holdings WHERE account_id = ?", (account_id,)
        ).fetchone()['n']
        if n_hold > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Account has {n_hold} holding(s). Remove them first.",
            )
        conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
        conn.commit()
        return {"deleted": account_id}


@app.get("/api/budgets")
def get_budgets():
    """Budget definitions with spent-this-period derived from transactions."""
    with get_db_connection() as conn:
        bgts = conn.execute(
            """
            SELECT id, category, subcategory, budget_amount, period,
                   alert_threshold_percent
            FROM budgets
            """
        ).fetchall()
        result = []
        for b in bgts:
            row = dict(b)
            period = (row.get('period') or 'monthly').lower()
            if period == 'weekly':
                window = "date('now', '-7 days')"
            elif period == 'annual':
                window = "date('now', 'start of year')"
            else:
                window = "date('now', 'start of month')"
            spent_row = conn.execute(
                f"""
                SELECT COALESCE(SUM(CASE WHEN transaction_type = 'credit' THEN -amount ELSE amount END), 0) AS spent
                FROM transactions
                WHERE category = ?
                  AND transaction_date >= {window}
                """,
                (row['category'],),
            ).fetchone()
            spent = float(spent_row['spent'] or 0)
            row['spent'] = round(spent, 2)
            row['remaining'] = round(float(row['budget_amount'] or 0) - spent, 2)
            result.append(row)
        return result


@app.get("/api/transactions")
def get_transactions(
    account_id: Optional[int] = None,
    category: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
    limit: int = 200,
    offset: int = 0,
):
    """Paginated transaction list with simple filters.

    `project_id`: filter to transactions tagged to this project (0 or -1 is
    ignored). Combine with `untagged_only=true` to show transactions with no
    project tag at all.
    """
    limit = max(1, min(limit, 1000))
    offset = max(0, offset)
    clauses = ["1=1"]
    params: list = []
    if account_id is not None:
        clauses.append("t.account_id = ?")
        params.append(account_id)
    if category:
        clauses.append("t.category = ?")
        params.append(category)
    if start:
        clauses.append("t.transaction_date >= ?")
        params.append(start)
    if end:
        clauses.append("t.transaction_date <= ?")
        params.append(end)
    if project_id is not None and project_id > 0:
        clauses.append("t.project_id = ?")
        params.append(project_id)
    elif untagged_only:
        clauses.append("t.project_id IS NULL")
    where = " AND ".join(clauses)
    with get_db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT t.id, t.account_id, a.name AS account_name, t.transaction_date,
                   t.posted_date, t.payee, t.amount, t.currency, t.category,
                   t.subcategory, t.description, t.transaction_type, t.import_source,
                   t.is_recurring, t.project_id, p.name AS project_name
            FROM transactions t
            LEFT JOIN accounts a ON a.id = t.account_id
            LEFT JOIN projects p ON p.id = t.project_id
            WHERE {where}
            ORDER BY t.transaction_date DESC, t.id DESC
            LIMIT ? OFFSET ?
            """,
            (*params, limit, offset),
        ).fetchall()
        total_row = conn.execute(
            f"SELECT COUNT(*) AS c FROM transactions t WHERE {where}",
            tuple(params),
        ).fetchone()
    return {"total": total_row["c"] if total_row else 0, "items": [dict(r) for r in rows]}


# ============================================================================
# Non-expense categories — binding principle as of 2026-04-25 per user decision:
#   "Investment spend isn't consumption; it's asset reallocation. Track it in
#    Portfolio, not Expenses."  We exclude these category values from every
#    expense report / money_out aggregation / burn computation so the
#    Advisor's recommendations, ExpenseAnalysis charts, and spending forecasts
#    don't treat asset moves as lifestyle drift.
#
# Transfers are also excluded — those move money between the user's own
# accounts.  `transaction_type = 'transfer'` already filters most of these,
# but we also exclude by category name for manually-tagged rows.
#
# Any new expense endpoint MUST compose `_NON_EXPENSE_CATEGORIES` into its
# WHERE clause.  Tested by /api/expenses/summary, /api/expenses/by-category,
# /api/expenses/monthly, /api/expenses/insights, /api/advisor/runway
# (baseline_living), /api/intel/spending-forecast.
# ============================================================================
_NON_EXPENSE_CATEGORIES: Tuple[str, ...] = ('Investment', 'Transfers')

def _non_expense_sql_clause(prefix: str = 't.') -> str:
    """Returns `AND <prefix>category NOT IN (...)` ready to splice into SQL.
    Safe for string interpolation — all values are known constants."""
    quoted = ', '.join(f"'{c}'" for c in _NON_EXPENSE_CATEGORIES)
    return f"AND ({prefix}category IS NULL OR {prefix}category NOT IN ({quoted}))"


def _apply_project_filter(
    where: list,
    params: list,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
    prefix: str = 't.',
) -> None:
    """Mutate `where` + `params` in place to add a project filter.
    `untagged_only=True` → only rows with NULL project_id (regardless of project_id arg).
    `project_id=N` → only that project's txns.
    Both unset → no filter.
    Used by every expense aggregation endpoint that supports the Expenses-page
    project dropdown so the filter applies to all charts, not just the txn list."""
    if untagged_only:
        where.append(f"{prefix}project_id IS NULL")
    elif project_id is not None:
        where.append(f"{prefix}project_id = ?")
        params.append(project_id)


@app.get("/api/expenses/monthly")
def api_expenses_monthly(
    account_id: Optional[int] = None,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
    months: int = 24,
):
    """Monthly money-in / money-out / net (all converted to AUD), excluding transfers
    and Investment/Transfers categories (asset moves, not consumption)."""
    months = max(1, min(months, 60))
    where = ["t.transaction_type != 'transfer'", "(t.category IS NULL OR t.category NOT IN ('Investment', 'Transfers'))"]
    params: list = []
    if account_id is not None:
        where.append("t.account_id = ?")
        params.append(account_id)
    _apply_project_filter(where, params, project_id, untagged_only)
    with get_db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT strftime('%Y-%m', t.transaction_date) AS month,
                   COALESCE(t.currency, 'AUD') AS currency,
                   SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS money_in,
                   -SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS money_out,
                   COUNT(*) AS transactions
            FROM transactions t
            WHERE {' AND '.join(where)}
            GROUP BY month, currency
            """,
            tuple(params),
        ).fetchall()
    _, fx = _fx_cache()
    by_month: Dict[str, dict] = {}
    for r in rows:
        m = r['month']
        rate = fx(r['currency'].upper(), 'AUD')
        agg = by_month.setdefault(m, {'month': m, 'money_in': 0.0, 'money_out': 0.0, 'transactions': 0})
        agg['money_in'] += r['money_in'] * rate
        agg['money_out'] += r['money_out'] * rate
        agg['transactions'] += r['transactions']
    out = [
        {**v, 'money_in': round(v['money_in'], 2), 'money_out': round(v['money_out'], 2),
         'net': round(v['money_in'] - v['money_out'], 2)}
        for v in by_month.values()
    ]
    out.sort(key=lambda x: x['month'])
    return out[-months:]


@app.get("/api/expenses/by-category")
def api_expenses_by_category(
    month: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    account_id: Optional[int] = None,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
):
    """Spending grouped by category. Excludes `transaction_type='transfer'`
    AND the `Investment`/`Transfers` categories (asset moves, not consumption).

    Use `month=YYYY-MM` OR an explicit `start`/`end` range.
    """
    where = ["t.amount < 0", "t.transaction_type != 'transfer'", "(t.category IS NULL OR t.category NOT IN ('Investment', 'Transfers'))"]
    params: list = []
    if month:
        where.append("strftime('%Y-%m', t.transaction_date) = ?")
        params.append(month)
    else:
        if start:
            where.append("t.transaction_date >= ?")
            params.append(start)
        if end:
            where.append("t.transaction_date <= ?")
            params.append(end)
    if account_id is not None:
        where.append("t.account_id = ?")
        params.append(account_id)
    _apply_project_filter(where, params, project_id, untagged_only)
    with get_db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT COALESCE(t.category, 'Uncategorised') AS category,
                   COALESCE(t.currency, 'AUD') AS currency,
                   -SUM(t.amount) AS amount,
                   COUNT(*) AS transactions
            FROM transactions t
            WHERE {' AND '.join(where)}
            GROUP BY category, currency
            """,
            tuple(params),
        ).fetchall()
    _, fx = _fx_cache()
    by_cat: Dict[str, dict] = {}
    for r in rows:
        rate = fx(r['currency'].upper(), 'AUD')
        agg = by_cat.setdefault(r['category'], {'category': r['category'], 'amount': 0.0, 'transactions': 0})
        agg['amount'] += r['amount'] * rate
        agg['transactions'] += r['transactions']
    out = [{**v, 'amount': round(v['amount'], 2)} for v in by_cat.values()]
    out.sort(key=lambda x: x['amount'], reverse=True)
    return out


@app.get("/api/expenses/by-merchant")
def api_expenses_by_merchant(
    month: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    category: Optional[str] = None,
    account_id: Optional[int] = None,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
    limit: int = 15,
):
    """Top-N merchants by spend. Excludes transfers + Investment/Transfers categories."""
    limit = max(1, min(limit, 100))
    where = ["t.amount < 0", "t.transaction_type != 'transfer'", "t.payee IS NOT NULL", "t.payee != ''", "(t.category IS NULL OR t.category NOT IN ('Investment', 'Transfers'))"]
    params: list = []
    if month:
        where.append("strftime('%Y-%m', t.transaction_date) = ?")
        params.append(month)
    else:
        if start:
            where.append("t.transaction_date >= ?")
            params.append(start)
        if end:
            where.append("t.transaction_date <= ?")
            params.append(end)
    if category:
        where.append("t.category = ?")
        params.append(category)
    if account_id is not None:
        where.append("t.account_id = ?")
        params.append(account_id)
    _apply_project_filter(where, params, project_id, untagged_only)
    with get_db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT t.payee AS merchant,
                   COALESCE(t.currency, 'AUD') AS currency,
                   -SUM(t.amount) AS amount,
                   COUNT(*) AS transactions,
                   MIN(t.transaction_date) AS first_seen,
                   MAX(t.transaction_date) AS last_seen
            FROM transactions t
            WHERE {' AND '.join(where)}
            GROUP BY t.payee, currency
            """,
            tuple(params),
        ).fetchall()
    _, fx = _fx_cache()
    by_m: Dict[str, dict] = {}
    for r in rows:
        rate = fx(r['currency'].upper(), 'AUD')
        agg = by_m.setdefault(r['merchant'], {
            'merchant': r['merchant'], 'amount': 0.0, 'transactions': 0,
            'first_seen': r['first_seen'], 'last_seen': r['last_seen'],
        })
        agg['amount'] += r['amount'] * rate
        agg['transactions'] += r['transactions']
        agg['first_seen'] = min(agg['first_seen'], r['first_seen'])
        agg['last_seen'] = max(agg['last_seen'], r['last_seen'])
    out = [{**v, 'amount': round(v['amount'], 2)} for v in by_m.values()]
    out.sort(key=lambda x: x['amount'], reverse=True)
    return out[:limit]


@app.get("/api/expenses/summary")
def api_expenses_summary(
    month: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    account_id: Optional[int] = None,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
):
    """Headline stats for a given month OR an explicit `start`/`end` range.

    Range mode (`start`+`end` set, ISO YYYY-MM-DD) drives the Expenses page's
    new time-range picker (Last 3mo / 6mo / 12mo / YTD / custom). When in range
    mode, `prev_*` fields compare to the equal-length immediately-prior window.

    `month` mode is preserved for callers (Telegram brief, Advisor) that still
    ask for a single month.
    """
    range_mode = bool(start and end)
    with get_db_connection() as conn:
        if range_mode:
            # Validate ISO dates lazily; pass through to SQLite which is forgiving.
            where = ["t.transaction_date >= ?", "t.transaction_date <= ?"]
            params: list = [start, end]
        else:
            if not month:
                r = conn.execute(
                    "SELECT strftime('%Y-%m', MAX(transaction_date)) AS m FROM transactions"
                ).fetchone()
                month = r['m'] if r and r['m'] else None
            if not month:
                return {"month": None}
            where = ["strftime('%Y-%m', t.transaction_date) = ?"]
            params = [month]
        if account_id is not None:
            where.append("t.account_id = ?")
            params.append(account_id)
        _apply_project_filter(where, params, project_id, untagged_only)
        base = f"FROM transactions t WHERE {' AND '.join(where)}"
        # Money-out and "biggest spend" exclude transfers AND the
        # Investment/Transfers categories — those are asset moves, not
        # consumption. Otherwise an ETF buy shows up as the month's "biggest
        # expense" and distorts the whole summary.
        rows = conn.execute(
            f"""
            SELECT COALESCE(t.currency, 'AUD') AS currency,
                   SUM(CASE WHEN amount > 0 AND transaction_type != 'transfer'
                                 AND (category IS NULL OR category NOT IN ('Investment','Transfers'))
                            THEN amount ELSE 0 END) AS money_in,
                   -SUM(CASE WHEN amount < 0 AND transaction_type != 'transfer'
                                  AND (category IS NULL OR category NOT IN ('Investment','Transfers'))
                             THEN amount ELSE 0 END) AS money_out,
                   COUNT(*) AS transactions
            {base}
            GROUP BY currency
            """,
            tuple(params),
        ).fetchall()
        biggest = conn.execute(
            f"""SELECT t.transaction_date, t.payee, t.amount, t.category, COALESCE(t.currency,'AUD') AS currency {base}
                AND amount < 0 AND transaction_type != 'transfer'
                AND (category IS NULL OR category NOT IN ('Investment','Transfers'))
                ORDER BY amount ASC LIMIT 1""",
            tuple(params),
        ).fetchone()
    _, fx = _fx_cache()
    money_in = money_out = 0.0
    txns = 0
    for r in rows:
        rate = fx(r['currency'].upper(), 'AUD')
        money_in += (r['money_in'] or 0) * rate
        money_out += (r['money_out'] or 0) * rate
        txns += r['transactions'] or 0
    biggest_dict = None
    if biggest:
        b = dict(biggest)
        rate = fx(b.get('currency', 'AUD').upper(), 'AUD')
        b['amount'] = round(b['amount'] * rate, 2)
        biggest_dict = b
    # Prior-period comparison.
    #   range mode → equal-length window immediately before `start`
    #   month mode → preceding calendar month + trailing 12-mo avg
    prev_money_out = avg12_money_out = None
    days_in_range = None
    avg_per_month = None
    daily_avg = None
    try:
        if range_mode:
            from datetime import date, timedelta
            s = date.fromisoformat(start)
            e = date.fromisoformat(end)
            days_in_range = (e - s).days + 1
            prev_e = s - timedelta(days=1)
            prev_s = prev_e - timedelta(days=days_in_range - 1)
            prev_money_out = _range_money_out(
                prev_s.isoformat(), prev_e.isoformat(),
                account_id, project_id, untagged_only,
            )
            # Avg per month = total / (days/30.44)
            if days_in_range > 0:
                avg_per_month = money_out / (days_in_range / 30.44)
                daily_avg = money_out / days_in_range
        else:
            y, mn = month.split('-')
            prev_y, prev_mn = (int(y), int(mn) - 1) if int(mn) > 1 else (int(y) - 1, 12)
            prev_month = f"{prev_y:04d}-{prev_mn:02d}"
            prev_money_out = _month_money_out(prev_month, account_id, project_id, untagged_only)
            avg12_money_out = _avg_money_out_last_n(month, 12, account_id, project_id, untagged_only)
    except Exception:
        pass

    return {
        "month": month if not range_mode else None,
        "start": start if range_mode else None,
        "end": end if range_mode else None,
        "range_mode": range_mode,
        "days_in_range": days_in_range,
        "avg_per_month": round(avg_per_month, 2) if avg_per_month is not None else None,
        "daily_avg": round(daily_avg, 2) if daily_avg is not None else None,
        "money_in": round(money_in, 2),
        "money_out": round(money_out, 2),
        "net": round(money_in - money_out, 2),
        "transactions": txns,
        "biggest_expense": biggest_dict,
        # Prior-period money_out (range mode = prior equal window; month mode = prev month).
        "prev_money_out": round(prev_money_out, 2) if prev_money_out is not None else None,
        "prev_month_money_out": round(prev_money_out, 2) if prev_money_out is not None and not range_mode else None,
        "twelve_month_avg_money_out": round(avg12_money_out, 2) if avg12_money_out is not None else None,
        # Pct delta (range = vs prior period; month = MoM)
        "vs_prior_pct": (
            round(((money_out - prev_money_out) / prev_money_out * 100), 1)
            if prev_money_out and prev_money_out > 0 else None
        ),
        "mom_delta_pct": (
            round(((money_out - prev_money_out) / prev_money_out * 100), 1)
            if prev_money_out and prev_money_out > 0 and not range_mode else None
        ),
        "vs_avg_pct": (
            round(((money_out - avg12_money_out) / avg12_money_out * 100), 1)
            if avg12_money_out and avg12_money_out > 0 else None
        ),
    }


def _range_money_out(
    start: str,
    end: str,
    account_id: Optional[int] = None,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
) -> float:
    """Sum money-out across an arbitrary date range (inclusive). Excludes
    transfers and Investment/Transfers categories. Used by summary's prior-
    period comparison when in range mode."""
    where = ["t.transaction_date >= ?", "t.transaction_date <= ?", "t.amount < 0",
             "t.transaction_type != 'transfer'",
             "(t.category IS NULL OR t.category NOT IN ('Investment', 'Transfers'))"]
    params: list = [start, end]
    if account_id is not None:
        where.append("t.account_id = ?")
        params.append(account_id)
    _apply_project_filter(where, params, project_id, untagged_only)
    with get_db_connection() as conn:
        rows = conn.execute(
            f"SELECT COALESCE(t.currency,'AUD') AS currency, -SUM(t.amount) AS amt "
            f"FROM transactions t WHERE {' AND '.join(where)} GROUP BY currency",
            tuple(params),
        ).fetchall()
    _, fx = _fx_cache()
    return sum((r['amt'] or 0) * fx(r['currency'].upper(), 'AUD') for r in rows)


def _month_money_out(
    month: str,
    account_id: Optional[int] = None,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
) -> float:
    where = ["strftime('%Y-%m', t.transaction_date) = ?", "t.amount < 0", "t.transaction_type != 'transfer'",
             "(t.category IS NULL OR t.category NOT IN ('Investment', 'Transfers'))"]
    params: list = [month]
    if account_id is not None:
        where.append("t.account_id = ?")
        params.append(account_id)
    _apply_project_filter(where, params, project_id, untagged_only)
    with get_db_connection() as conn:
        rows = conn.execute(
            f"SELECT COALESCE(t.currency,'AUD') AS currency, -SUM(t.amount) AS amt "
            f"FROM transactions t WHERE {' AND '.join(where)} GROUP BY currency",
            tuple(params),
        ).fetchall()
    _, fx = _fx_cache()
    return sum((r['amt'] or 0) * fx(r['currency'].upper(), 'AUD') for r in rows)


def _avg_money_out_last_n(
    anchor_month: str,
    n: int,
    account_id: Optional[int] = None,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
) -> Optional[float]:
    """Average money_out over the n months ending at (anchor_month - 1)."""
    y, m = (int(x) for x in anchor_month.split('-'))
    months = []
    for i in range(1, n + 1):
        ym = m - i
        yy = y
        while ym <= 0:
            ym += 12
            yy -= 1
        months.append(f"{yy:04d}-{ym:02d}")
    vals = [_month_money_out(mm, account_id, project_id, untagged_only) for mm in months]
    vals = [v for v in vals if v > 0]
    return sum(vals) / len(vals) if vals else None


@app.get("/api/expenses/daily")
def api_expenses_daily(
    month: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    account_id: Optional[int] = None,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
):
    """Daily money-in / money-out for a month OR an explicit `start`/`end`
    range, FX-converted to AUD. Excludes Investment/Transfers categories
    (asset moves, not consumption).

    Range mode powers the Expenses page when the user selects multi-month
    windows (Last 3mo / 6mo / 12mo). Note: the calendar daily heatmap UI hides
    itself when range > 1 calendar month — but this endpoint still returns
    every day in the window for any caller that wants raw daily values."""
    if start and end:
        where = ["t.transaction_date >= ?", "t.transaction_date <= ?",
                 "t.transaction_type != 'transfer'",
                 "(t.category IS NULL OR t.category NOT IN ('Investment', 'Transfers'))"]
        params: list = [start, end]
    else:
        if not month:
            return []
        where = ["strftime('%Y-%m', t.transaction_date) = ?", "t.transaction_type != 'transfer'",
                 "(t.category IS NULL OR t.category NOT IN ('Investment', 'Transfers'))"]
        params = [month]
    if account_id is not None:
        where.append("t.account_id = ?")
        params.append(account_id)
    _apply_project_filter(where, params, project_id, untagged_only)
    with get_db_connection() as conn:
        rows = conn.execute(
            f"""SELECT t.transaction_date AS date, COALESCE(t.currency,'AUD') AS currency,
                       SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS money_in,
                       -SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS money_out,
                       COUNT(*) AS n
                FROM transactions t WHERE {' AND '.join(where)}
                GROUP BY date, currency""",
            tuple(params),
        ).fetchall()
    _, fx = _fx_cache()
    by_date: Dict[str, dict] = {}
    for r in rows:
        d = r['date']
        rate = fx(r['currency'].upper(), 'AUD')
        agg = by_date.setdefault(d, {'date': d, 'money_in': 0.0, 'money_out': 0.0, 'transactions': 0})
        agg['money_in'] += (r['money_in'] or 0) * rate
        agg['money_out'] += (r['money_out'] or 0) * rate
        agg['transactions'] += r['n'] or 0
    out = [
        {**v, 'money_in': round(v['money_in'], 2), 'money_out': round(v['money_out'], 2),
         'net': round(v['money_in'] - v['money_out'], 2)}
        for v in by_date.values()
    ]
    out.sort(key=lambda x: x['date'])
    return out


@app.get("/api/expenses/weekday")
def api_expenses_weekday(
    months: int = 12,
    account_id: Optional[int] = None,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
):
    """Average money_out by day-of-week over the last N months.
    Excludes Investment/Transfers categories."""
    months = max(1, min(months, 60))
    where = ["t.amount < 0", "t.transaction_type != 'transfer'",
             "(t.category IS NULL OR t.category NOT IN ('Investment', 'Transfers'))",
             "t.transaction_date >= date('now', ?)"]
    params: list = [f'-{months} months']
    if account_id is not None:
        where.append("t.account_id = ?")
        params.append(account_id)
    _apply_project_filter(where, params, project_id, untagged_only)
    with get_db_connection() as conn:
        rows = conn.execute(
            f"""SELECT CAST(strftime('%w', t.transaction_date) AS INTEGER) AS dow,
                       COALESCE(t.currency,'AUD') AS currency,
                       -SUM(t.amount) AS amount,
                       COUNT(*) AS n
                FROM transactions t WHERE {' AND '.join(where)}
                GROUP BY dow, currency""",
            tuple(params),
        ).fetchall()
    _, fx = _fx_cache()
    names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    by_dow: Dict[int, dict] = {i: {'dow': i, 'name': names[i], 'amount': 0.0, 'transactions': 0} for i in range(7)}
    for r in rows:
        rate = fx(r['currency'].upper(), 'AUD')
        by_dow[r['dow']]['amount'] += (r['amount'] or 0) * rate
        by_dow[r['dow']]['transactions'] += r['n'] or 0
    return [{**v, 'amount': round(v['amount'], 2)} for v in by_dow.values()]


@app.get("/api/expenses/category-trend")
def api_expenses_category_trend(
    months: int = 12,
    account_id: Optional[int] = None,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
    top_n: int = 8,
):
    """Per-category monthly spend over the last N months. Returns the top_n
    categories by total spend; the rest get bucketed as 'Other'.
    Excludes Investment/Transfers categories (asset moves, not consumption)."""
    months = max(2, min(months, 60))
    where = ["t.amount < 0", "t.transaction_type != 'transfer'",
             "(t.category IS NULL OR t.category NOT IN ('Investment', 'Transfers'))",
             "t.transaction_date >= date('now', ?)"]
    params: list = [f'-{months} months']
    if account_id is not None:
        where.append("t.account_id = ?")
        params.append(account_id)
    _apply_project_filter(where, params, project_id, untagged_only)
    with get_db_connection() as conn:
        rows = conn.execute(
            f"""SELECT strftime('%Y-%m', t.transaction_date) AS month,
                       COALESCE(t.category, 'Uncategorised') AS category,
                       COALESCE(t.currency,'AUD') AS currency,
                       -SUM(t.amount) AS amount
                FROM transactions t WHERE {' AND '.join(where)}
                GROUP BY month, category, currency""",
            tuple(params),
        ).fetchall()
    _, fx = _fx_cache()
    cat_totals: Dict[str, float] = {}
    series: Dict[tuple, float] = {}  # (month, cat) -> aud
    months_seen = set()
    for r in rows:
        rate = fx(r['currency'].upper(), 'AUD')
        amt = (r['amount'] or 0) * rate
        cat_totals[r['category']] = cat_totals.get(r['category'], 0) + amt
        series[(r['month'], r['category'])] = series.get((r['month'], r['category']), 0) + amt
        months_seen.add(r['month'])
    top_cats = [c for c, _ in sorted(cat_totals.items(), key=lambda x: -x[1])[:top_n]]
    other_cats = set(cat_totals) - set(top_cats)
    months_sorted = sorted(months_seen)
    out = []
    for m in months_sorted:
        row = {'month': m}
        for c in top_cats:
            row[c] = round(series.get((m, c), 0), 2)
        if other_cats:
            row['Other'] = round(sum(series.get((m, c), 0) for c in other_cats), 2)
        out.append(row)
    legend = top_cats + (['Other'] if other_cats else [])
    return {'months': months_sorted, 'categories': legend, 'series': out}


@app.get("/api/expenses/insights")
def api_expenses_insights(
    month: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    account_id: Optional[int] = None,
    project_id: Optional[int] = None,
    untagged_only: bool = False,
):
    """Auto-generated insights for the given month OR explicit `start`/`end`
    range: top movers, new merchants, anomalies.

    Range mode: top movers compare current period vs prior equal-length period.
    `new merchants` look for payees in current period that weren't seen in the
    prior 6 months before `start`."""
    range_mode = bool(start and end)
    with get_db_connection() as conn:
        from datetime import date, timedelta
        if range_mode:
            cur_start, cur_end = start, end
            s = date.fromisoformat(start)
            e = date.fromisoformat(end)
            days = (e - s).days + 1
            prev_e = s - timedelta(days=1)
            prev_s = prev_e - timedelta(days=days - 1)
            prev_start, prev_end = prev_s.isoformat(), prev_e.isoformat()
            new_merchants_anchor = start  # cutoff for "prior 6mo" window
        else:
            if not month:
                r = conn.execute(
                    "SELECT strftime('%Y-%m', MAX(transaction_date)) AS m FROM transactions"
                ).fetchone()
                month = r['m'] if r and r['m'] else None
            if not month:
                return {"month": None, "insights": []}
            y, mn = month.split('-')
            cur_start = f"{int(y):04d}-{int(mn):02d}-01"
            # Last day of `month`.
            if int(mn) == 12:
                next_first = f"{int(y) + 1:04d}-01-01"
            else:
                next_first = f"{int(y):04d}-{int(mn) + 1:02d}-01"
            cur_end = (date.fromisoformat(next_first) - timedelta(days=1)).isoformat()
            prev_y, prev_mn = (int(y), int(mn) - 1) if int(mn) > 1 else (int(y) - 1, 12)
            prev_start = f"{prev_y:04d}-{prev_mn:02d}-01"
            if prev_mn == 12:
                prev_next_first = f"{prev_y + 1:04d}-01-01"
            else:
                prev_next_first = f"{prev_y:04d}-{prev_mn + 1:02d}-01"
            prev_end = (date.fromisoformat(prev_next_first) - timedelta(days=1)).isoformat()
            new_merchants_anchor = cur_start

        def _by_cat(s_iso: str, e_iso: str) -> Dict[str, float]:
            where = ["t.transaction_date >= ?", "t.transaction_date <= ?",
                     "t.amount < 0", "t.transaction_type != 'transfer'",
                     "(t.category IS NULL OR t.category NOT IN ('Investment', 'Transfers'))"]
            params: list = [s_iso, e_iso]
            if account_id is not None:
                where.append("t.account_id = ?")
                params.append(account_id)
            _apply_project_filter(where, params, project_id, untagged_only)
            rows = conn.execute(
                f"SELECT COALESCE(t.category,'Uncategorised') AS c, COALESCE(t.currency,'AUD') AS ccy, "
                f"-SUM(t.amount) AS a FROM transactions t WHERE {' AND '.join(where)} GROUP BY c, ccy",
                tuple(params),
            ).fetchall()
            _, fx = _fx_cache()
            agg: Dict[str, float] = {}
            for r in rows:
                agg[r['c']] = agg.get(r['c'], 0) + (r['a'] or 0) * fx(r['ccy'].upper(), 'AUD')
            return agg

        cur = _by_cat(cur_start, cur_end)
        prev = _by_cat(prev_start, prev_end)
        all_cats = set(cur) | set(prev)
        movers = []
        for c in all_cats:
            cur_v = cur.get(c, 0)
            prev_v = prev.get(c, 0)
            delta = cur_v - prev_v
            if abs(delta) < 50:
                continue
            pct = ((cur_v - prev_v) / prev_v * 100) if prev_v > 0 else None
            movers.append({
                'category': c,
                'current': round(cur_v, 2),
                'previous': round(prev_v, 2),
                'delta': round(delta, 2),
                'delta_pct': round(pct, 1) if pct is not None else None,
            })
        movers.sort(key=lambda m: -abs(m['delta']))

        # New merchants: appearing in current period but not in the 6 months
        # immediately preceding `cur_start`. Window is the same in month + range
        # mode; only the anchor moves.
        where_cur = ["t.transaction_date >= ?", "t.transaction_date <= ?",
                     "t.amount < 0", "t.transaction_type != 'transfer'",
                     "(t.category IS NULL OR t.category NOT IN ('Investment', 'Transfers'))",
                     "t.payee IS NOT NULL", "t.payee != ''"]
        params_cur: list = [cur_start, cur_end]
        if account_id is not None:
            where_cur.append("t.account_id = ?")
            params_cur.append(account_id)
        _apply_project_filter(where_cur, params_cur, project_id, untagged_only)
        cur_merchants = conn.execute(
            f"SELECT DISTINCT t.payee FROM transactions t WHERE {' AND '.join(where_cur)}",
            tuple(params_cur),
        ).fetchall()

        where_prior = ["t.amount < 0", "t.transaction_type != 'transfer'",
                       "(t.category IS NULL OR t.category NOT IN ('Investment', 'Transfers'))",
                       "t.payee IS NOT NULL", "t.payee != ''",
                       "t.transaction_date < ?",
                       "t.transaction_date >= date(?, '-6 months')"]
        params_prior: list = [cur_start, cur_start]
        if account_id is not None:
            where_prior.append("t.account_id = ?")
            params_prior.append(account_id)
        _apply_project_filter(where_prior, params_prior, project_id, untagged_only)
        prior_merchants = {r['payee'] for r in conn.execute(
            f"SELECT DISTINCT t.payee FROM transactions t WHERE {' AND '.join(where_prior)}",
            tuple(params_prior),
        ).fetchall()}

        new_merchants_list = []
        for r in cur_merchants:
            if r['payee'] not in prior_merchants:
                # Get the spend for that merchant within the current period.
                row = conn.execute(
                    "SELECT COALESCE(t.currency,'AUD') AS ccy, -SUM(t.amount) AS a, COUNT(*) AS n "
                    "FROM transactions t "
                    "WHERE t.transaction_date >= ? AND t.transaction_date <= ? "
                    "AND t.payee = ? AND t.amount < 0 AND t.transaction_type != 'transfer' "
                    "GROUP BY ccy",
                    (cur_start, cur_end, r['payee']),
                ).fetchone()
                if row:
                    _, fx = _fx_cache()
                    new_merchants_list.append({
                        'merchant': r['payee'],
                        'amount': round((row['a'] or 0) * fx(row['ccy'].upper(), 'AUD'), 2),
                        'transactions': row['n'],
                    })
        new_merchants_list.sort(key=lambda m: -m['amount'])

    insights = []
    period_word = 'period' if range_mode else 'month'
    # Top movers
    for m in movers[:5]:
        direction = 'up' if m['delta'] > 0 else 'down'
        if m['delta_pct'] is not None:
            insights.append({
                'kind': 'mover',
                'severity': 'info' if direction == 'down' else ('warn' if abs(m['delta_pct']) > 50 else 'info'),
                'title': f"{m['category']} {direction} {abs(m['delta_pct']):.0f}%",
                'detail': f"${m['previous']:,.0f} → ${m['current']:,.0f} (Δ ${m['delta']:+,.0f})",
                'category': m['category'],
            })
        else:
            insights.append({
                'kind': 'mover',
                'severity': 'info',
                'title': f"{m['category']} new this {period_word}",
                'detail': f"${m['current']:,.0f} (no prior-{period_word} spend)",
                'category': m['category'],
            })

    for nm in new_merchants_list[:3]:
        insights.append({
            'kind': 'new_merchant',
            'severity': 'info',
            'title': f"New merchant: {nm['merchant']}",
            'detail': f"${nm['amount']:,.0f} across {nm['transactions']} txn(s)",
            'merchant': nm['merchant'],
        })

    return {
        'month': month if not range_mode else None,
        'start': cur_start, 'end': cur_end, 'range_mode': range_mode,
        'insights': insights, 'movers': movers[:10], 'new_merchants': new_merchants_list[:10],
    }


@app.post("/api/transactions/detect-recurring")
def api_detect_recurring():
    """Scan transactions; flag recurring buckets (same payee + amount ≥3× at stable cadence)."""
    try:
        from wealthguard_recurring import detect
        return detect(update=True)
    except Exception as e:
        logger.exception("recurring detection failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/transactions/import")
async def import_transactions_csv(
    file: UploadFile = File(...),
    account_name: str = Form(...),
    date_format: Optional[str] = Form(None),
):
    """Accept a CSV file and import into transactions via wealthguard_utils."""
    import tempfile
    from wealthguard_utils import import_csv_transactions

    if not file.filename or not file.filename.lower().endswith(('.csv', '.txt')):
        raise HTTPException(status_code=400, detail="Expected a .csv file")

    body = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        tmp.write(body)
        tmp_path = tmp.name
    try:
        result = import_csv_transactions(tmp_path, account_name, date_format)
    except Exception as e:
        logger.exception("CSV import failed")
        raise HTTPException(status_code=500, detail=f"Import failed: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    # Older versions returned an int; normalize.
    if isinstance(result, int):
        result = {"imported": result, "skipped": 0, "account_id": None}
    return result


def _goal_to_dict(row) -> Dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "target_amount": row["target_amount"],
        "target_date": row["target_date"],
        "notes": row["notes"],
        "created_at": row["created_at"],
    }


def _net_worth_breakdown_aud() -> Dict[str, float]:
    """Return the live net-worth breakdown in AUD. Single source of truth.

    Components:
      - investments_aud: sum of `holdings` (equity/crypto FX'd USD→AUD, alt at AUD)
      - cash_aud:        sum of active savings + checking accounts (FX'd to AUD)
      - liabilities_aud: sum of active credit-type accounts (FX'd to AUD)
      - assets_aud:      investments_aud + cash_aud
      - net_worth_aud:   assets_aud - liabilities_aud
      - last_updated:    max(holdings.last_price_update) — the freshest input
    """
    investments = 0.0
    cash = 0.0
    liabilities = 0.0
    last_updated: Optional[str] = None
    with get_db_connection() as conn:
        holdings = conn.execute(
            "SELECT shares, current_price, asset_class, native_currency, last_price_update "
            "FROM holdings WHERE shares > 0"
        ).fetchall()
        for h in holdings:
            price = h["current_price"] or 0
            shares = h["shares"] or 0
            # Iteration 24 fix: use the holding's `native_currency` per row,
            # mirroring `_enrich_holding()` (~line 564). The previous coarse
            # rule (`USD if asset_class in (crypto, equity) else 1.0`) over-FX'd
            # AUD-native equities (CBA: AUD treated as USD) and under-FX'd
            # USD-native ETFs (XLE: USD treated as AUD), netting a ~$480
            # inflation in `net_worth_aud` vs. the per-holding sum the frontend
            # gets from /api/holdings.
            ccy = (h["native_currency"] or "").upper()
            if not ccy:
                cls = (h["asset_class"] or "").lower()
                # Fallback when native_currency is null. Equity / ETF / mutual
                # fund / crypto default to USD (the world's most common quote
                # currency for those instruments). Alternative (real estate +
                # vehicles) and bonds default to AUD in this DB.
                ccy = "USD" if cls in ("crypto", "equity", "etf", "mutual_fund") else "AUD"
            fx = get_fx_rate(ccy, "AUD")
            investments += price * shares * fx
            ts = h["last_price_update"]
            if ts and (last_updated is None or ts > last_updated):
                last_updated = ts
        accounts = conn.execute(
            "SELECT current_balance, currency, type FROM accounts "
            "WHERE is_active = 1 AND type IN ('savings','checking','credit')"
        ).fetchall()
        for a in accounts:
            bal = (a["current_balance"] or 0) * get_fx_rate(a["currency"] or "AUD", "AUD")
            if a["type"] == "credit":
                liabilities += bal
            else:
                cash += bal
    assets = investments + cash
    return {
        "investments_aud": round(investments, 2),
        "cash_aud": round(cash, 2),
        "liabilities_aud": round(liabilities, 2),
        "assets_aud": round(assets, 2),
        "net_worth_aud": round(assets - liabilities, 2),
        "last_updated": last_updated,
    }


def _current_net_worth_aud() -> float:
    """Backwards-compat wrapper — returns just the net-worth scalar in AUD."""
    return _net_worth_breakdown_aud()["net_worth_aud"]


@app.get("/api/net-worth/live")
def api_net_worth_live():
    """Canonical live net worth (AUD) with a component breakdown."""
    return _net_worth_breakdown_aud()


def _enrich_goal(d: Dict, current_value: float) -> Dict:
    target = float(d.get("target_amount") or 0)
    progress_pct = (current_value / target) * 100 if target > 0 else 0
    projected: Optional[str] = None
    # Use last 30-day net_worth slope (if any) to project completion.
    try:
        with get_db_connection() as conn:
            history = conn.execute(
                "SELECT snapshot_date, net_worth FROM net_worth_history "
                "WHERE snapshot_date >= date('now','-30 days') "
                "ORDER BY snapshot_date ASC"
            ).fetchall()
        if len(history) >= 2 and target > current_value:
            first = history[0]
            last = history[-1]
            days = (datetime.fromisoformat(last["snapshot_date"]) -
                    datetime.fromisoformat(first["snapshot_date"])).days
            delta = (last["net_worth"] or 0) - (first["net_worth"] or 0)
            if days > 0 and delta > 0:
                daily = delta / days
                remaining = target - current_value
                days_to_go = remaining / daily
                projected = (datetime.now() + timedelta(days=days_to_go)).strftime("%Y-%m-%d")
    except Exception:
        projected = None
    return {
        **d,
        "current_value": round(current_value, 2),
        "progress_pct": round(progress_pct, 2),
        "projected_date": projected,
    }


@app.get("/api/goals")
def list_goals():
    current = _current_net_worth_aud()
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, target_amount, target_date, notes, created_at "
            "FROM goals ORDER BY target_date ASC, created_at DESC"
        ).fetchall()
    return [_enrich_goal(_goal_to_dict(r), current) for r in rows]


@app.post("/api/goals")
def create_goal(goal: GoalIn):
    with get_db_connection() as conn:
        cur = conn.execute(
            "INSERT INTO goals (name, target_amount, target_date, notes) VALUES (?, ?, ?, ?)",
            (goal.name, goal.target_amount, goal.target_date, goal.notes),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, name, target_amount, target_date, notes, created_at FROM goals WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
    return _enrich_goal(_goal_to_dict(row), _current_net_worth_aud())


@app.put("/api/goals/{goal_id}")
def update_goal(goal_id: int, goal: GoalIn):
    with get_db_connection() as conn:
        cur = conn.execute(
            "UPDATE goals SET name = ?, target_amount = ?, target_date = ?, notes = ? WHERE id = ?",
            (goal.name, goal.target_amount, goal.target_date, goal.notes, goal_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Goal not found")
        conn.commit()
        row = conn.execute(
            "SELECT id, name, target_amount, target_date, notes, created_at FROM goals WHERE id = ?",
            (goal_id,),
        ).fetchone()
    return _enrich_goal(_goal_to_dict(row), _current_net_worth_aud())


@app.delete("/api/goals/{goal_id}")
def delete_goal(goal_id: int):
    with get_db_connection() as conn:
        cur = conn.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Goal not found")
        conn.commit()
    return {"deleted": goal_id}


_SYNC_SCRIPT = str(Path(__file__).parent / 'wealthguard_data_sync.py')


@app.post("/api/sync/prices")
def trigger_price_sync():
    """Trigger a price sync (runs in background)"""
    import subprocess
    import sys as _sys
    try:
        subprocess.Popen(
            [_sys.executable, _SYNC_SCRIPT],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env={**os.environ, 'DATABASE_PATH': DB_PATH},
        )
        return {"status": "sync_triggered", "message": "Price sync started in background"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trigger sync: {str(e)}")


# News & Market Intelligence Endpoints
@app.get("/api/news/market")
def get_market_news():
    """Get latest financial market news from NewsApi.ai"""
    try:
        # Import here to avoid startup issues
        import asyncio
        from wealthguard_news import NewsIntelligence
        
        async def fetch():
            async with NewsIntelligence() as news:
                return await news.fetch_financial_news(
                    query="stock market OR crypto OR bitcoin OR ethereum",
                    days=1,
                    max_results=20
                )
        
        articles = asyncio.run(fetch())
        
        return {
            "count": len(articles),
            "updated_at": datetime.now().isoformat(),
            "articles": [
                {
                    "title": a.title,
                    "source": a.source,
                    "url": a.url,
                    "published_at": a.published_at,
                    "summary": a.summary,
                    "sentiment": a.sentiment,
                    "relevance": a.relevance
                }
                for a in articles
            ]
        }
    except Exception as e:
        # Graceful fallback
        return {
            "count": 0,
            "updated_at": datetime.now().isoformat(),
            "error": str(e),
            "articles": [],
            "note": "NewsApi.ai integration not configured or key invalid"
        }


@app.get("/api/news/sentiment")
def get_market_sentiment():
    """Get overall market sentiment analysis"""
    try:
        import asyncio
        from wealthguard_news import NewsIntelligence
        
        async def fetch():
            async with NewsIntelligence() as news:
                return await news.get_market_sentiment()
        
        sentiment = asyncio.run(fetch())
        return sentiment
    except Exception as e:
        return {
            "score": 0,
            "label": "unavailable",
            "error": str(e),
            "articles_analyzed": 0,
            "note": "NewsApi.ai integration not configured"
        }


@app.get("/api/news/portfolio/{symbol}")
def get_symbol_news(symbol: str):
    """Get news for a specific symbol (e.g., AAPL, BTC)"""
    try:
        import asyncio
        from wealthguard_news import NewsIntelligence
        
        async def fetch():
            async with NewsIntelligence() as news:
                articles = await news.fetch_financial_news(
                    symbols=[symbol.upper()],
                    days=7,
                    max_results=10
                )
                return articles
        
        articles = asyncio.run(fetch())
        
        return {
            "symbol": symbol.upper(),
            "count": len(articles),
            "articles": [
                {
                    "title": a.title,
                    "source": a.source,
                    "url": a.url,
                    "published_at": a.published_at,
                    "summary": a.summary,
                    "sentiment": a.sentiment
                }
                for a in articles
            ]
        }
    except Exception as e:
        return {
            "symbol": symbol.upper(),
            "count": 0,
            "error": str(e),
            "articles": []
        }


# Intelligence endpoints
@app.get("/api/intelligence/daily")
def get_daily_intelligence():
    """Get daily intelligence briefing"""
    try:
        from intelligence_engine import IntelligenceEngine
        engine = IntelligenceEngine()
        return engine.get_daily_briefing()
    except Exception as e:
        logger.error(f"Intelligence error: {e}")
        return {"error": str(e), "date": datetime.now().isoformat()}


# ============================================================================
# AI Rate-change Watcher
#
# Top wealth-coach pick (~$8-12k/yr impact for this user).
#
# What it does: scans Christopher & Nicole's actual savings/checking accounts
# vs the current Australian high-yield-savings landscape (rate floor ~5.15%,
# rate ceiling ~5.50% as of 2026-04). Computes the dollar opportunity from
# either (a) moving idle 0% balances to a yielding account, or (b) switching
# to a competitor offering a meaningfully better rate than Rabobank.  Then
# asks Kimi for a one-paragraph "what to do this week" narrative.
#
# Cached 6 hours — rates don't change daily and Kimi has cost.
# ============================================================================
_RATE_WATCHER_CACHE: Dict[str, object] = {'t': 0.0, 'data': None}
_RATE_WATCHER_TTL = 21600  # 6h


def _with_cache_meta(data, ts: float, now: float, stale: bool = False):
    """Decorate a cached AI-endpoint payload with freshness metadata so the
    frontend can render "Generated 2h ago · stale" without re-firing Kimi.

    Used by every /api/intel/* endpoint that runs a Kimi/Gemini call and
    supports the `cache_only=True` peek mode (Iteration 22 manual-gating
    pattern). Adds three fields to the dict: `_cached_at` (ISO 8601 UTC),
    `_age_seconds` (int), `_stale` (bool). Non-dict payloads are returned
    untouched."""
    if not isinstance(data, dict):
        return data
    age = max(0, int(now - (ts or 0)))
    return {
        **data,
        '_cached_at': datetime.utcfromtimestamp(ts).isoformat() + 'Z' if ts else None,
        '_age_seconds': age,
        '_stale': bool(stale),
    }

# Curated AU savings landscape ~2026-04 — known top accounts. Sourced from
# Canstar/RBA periodically; updated manually when rates shift materially.
# When Kimi or a scraping endpoint becomes available, replace this with a
# live fetch.
AU_RATE_LANDSCAPE_2026Q2 = [
    {"provider": "Rabobank", "product": "PremiumSaver", "apy": 5.50, "caveats": "monthly bonus tier; user already has this"},
    {"provider": "ING",      "product": "Savings Maximiser", "apy": 5.50, "caveats": "$1k+ monthly deposit + 5+ purchases on linked Orange Everyday"},
    {"provider": "Macquarie","product": "Savings Account",   "apy": 5.00, "caveats": "ongoing rate, no hoops"},
    {"provider": "AMP",      "product": "Saver",             "apy": 5.40, "caveats": "$0-25k 5.40%; tiered above"},
    {"provider": "Police Bank","product":"PowerSave",        "apy": 5.50, "caveats": "members only; eligibility check"},
    {"provider": "ME Bank",  "product": "HomeME / SaveME",   "apy": 5.55, "caveats": "$2k deposit/mo + monthly balance grow"},
    {"provider": "Bank of Queensland","product":"Future Saver", "apy": 5.50, "caveats": "age 14-35; not applicable"},
    {"provider": "ubank",    "product": "Save",              "apy": 5.50, "caveats": "$500/mo deposit"},
]
AU_RATE_FLOOR = 5.15
AU_RATE_CEILING = max(p['apy'] for p in AU_RATE_LANDSCAPE_2026Q2)


@app.get("/api/intel/rate-watcher")
def api_rate_watcher(force: bool = False, cache_only: bool = False):
    """AI-powered savings rate watch — finds dollar opportunities vs the live AU landscape.

    `cache_only=True` (Iteration 22 manual-gating mode): return cached result if
    any (fresh or stale) without firing Kimi on cache miss; emit `{cached: false}`
    when no cache exists yet. Used by the frontend on page mount so token spend
    only happens when the user explicitly clicks "Run fresh analysis"."""
    import time as _time
    now = _time.time()
    cached = _RATE_WATCHER_CACHE.get('data')
    ts = _RATE_WATCHER_CACHE.get('t') or 0
    if not force:
        if cached and (now - ts) < _RATE_WATCHER_TTL:
            return _with_cache_meta(cached, ts, now)
        if cache_only:
            if cached:
                return _with_cache_meta(cached, ts, now, stale=True)
            return {'cached': False}

    _, fx = _fx_cache()
    try:
        with get_db_connection() as conn:
            account_rows = conn.execute(
                """SELECT id, name, currency, current_balance, COALESCE(apy, 0) AS apy, type
                   FROM accounts
                   WHERE is_active = 1 AND type IN ('savings','checking')
                   ORDER BY current_balance DESC""",
            ).fetchall()
        accounts = [dict(r) for r in account_rows]
        for a in accounts:
            a['balance_aud'] = round((a['current_balance'] or 0) * fx((a['currency'] or 'AUD').upper(), 'AUD'), 2)
            a['monthly_aud_at_current_apy'] = round(a['balance_aud'] * (a['apy'] or 0) / 100.0 / 12.0, 2)
            a['monthly_aud_at_market_ceiling'] = round(a['balance_aud'] * AU_RATE_CEILING / 100.0 / 12.0, 2)
            a['monthly_uplift_aud'] = round(a['monthly_aud_at_market_ceiling'] - a['monthly_aud_at_current_apy'], 2)

        # Aggregate opportunities by category
        idle_zero = [a for a in accounts if (a['apy'] or 0) == 0 and a['balance_aud'] > 100]
        underperforming = [a for a in accounts if 0 < (a['apy'] or 0) < AU_RATE_CEILING - 0.25 and a['balance_aud'] > 100]

        idle_total_aud = sum(a['balance_aud'] for a in idle_zero)
        underperf_total_aud = sum(a['balance_aud'] for a in underperforming)
        opp_idle_monthly = sum(a['monthly_uplift_aud'] for a in idle_zero)
        opp_under_monthly = sum(a['monthly_uplift_aud'] for a in underperforming)
        total_monthly_uplift = round(opp_idle_monthly + opp_under_monthly, 2)
        total_yearly_uplift = round(total_monthly_uplift * 12, 2)

        # Build a Kimi narrative
        kimi_narrative: Optional[str] = None
        kimi_provider = 'kimi'
        try:
            account_lines = '\n'.join(
                f"  · {a['name']:<25} {a['currency']} {a['balance_aud']:>10,.0f} AUD @ {(a['apy'] or 0):.2f}% APY  →  uplift potential ${a['monthly_uplift_aud']:>5,.0f}/mo"
                for a in accounts
            )
            landscape_lines = '\n'.join(
                f"  · {p['provider']:<18} {p['product']:<22} {p['apy']:.2f}%  ({p['caveats']})"
                for p in AU_RATE_LANDSCAPE_2026Q2
            )
            system = (
                "You are a no-nonsense AU personal-finance coach for Christopher & Nicole Howell, retired-early couple, "
                "in DRAWDOWN mode (cash-yielding savings is a major income source). "
                "Be direct. Quantify everything in AUD/mo. No disclaimers. No 'consider'. State the move."
            )
            user = (
                f"USER ACCOUNTS (live):\n{account_lines}\n\n"
                f"AU MARKET LANDSCAPE (curated 2026-Q2):\n{landscape_lines}\n\n"
                f"GAP ANALYSIS:\n"
                f"  · {len(idle_zero)} accounts at 0% APY totalling ${idle_total_aud:,.0f}\n"
                f"  · {len(underperforming)} accounts below market ceiling ({AU_RATE_CEILING:.2f}%) totalling ${underperf_total_aud:,.0f}\n"
                f"  · Total monthly uplift if EVERY $ moved to ceiling rate: ${total_monthly_uplift:,.0f}/mo (${total_yearly_uplift:,.0f}/yr)\n\n"
                "Write ONE 90-word paragraph: (1) name the single highest-leverage move TODAY, (2) the second move "
                "if any, (3) any caveat about hoop-jumping requirements. Lead with the dollar number."
            )
            kimi_narrative = _kimi_chat(system, user, max_tokens=4000, temperature=1)
        except Exception as e:
            logger.warning(f"rate-watcher Kimi call failed: {e}")
            kimi_narrative = None

        if not kimi_narrative:
            # Fallback narrative — deterministic, always works.
            top_idle = max(idle_zero, key=lambda x: x['balance_aud'], default=None)
            if top_idle:
                kimi_narrative = (
                    f"Move ${top_idle['balance_aud']:,.0f} from {top_idle['name']} (currently 0% APY) to a "
                    f"{AU_RATE_FLOOR:.2f}%+ AUD savings account this week. That single move adds "
                    f"${top_idle['monthly_uplift_aud']:,.0f}/mo to passive income. "
                    f"Rabobank PremiumSaver, ING Savings Maximiser, and ubank Save all offer ≥{AU_RATE_CEILING:.2f}% with modest hoops."
                )
                kimi_provider = 'fallback'
            else:
                kimi_narrative = (
                    "All cash is currently at or near market-ceiling APY. No rate-switching opportunity right now."
                )
                kimi_provider = 'fallback'

        # Highest-leverage single move
        all_opps = sorted(idle_zero + underperforming, key=lambda x: x['monthly_uplift_aud'], reverse=True)
        top_move = all_opps[0] if all_opps else None

        data = {
            'as_of': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
            'market_floor_apy': AU_RATE_FLOOR,
            'market_ceiling_apy': AU_RATE_CEILING,
            'landscape': AU_RATE_LANDSCAPE_2026Q2,
            'accounts': accounts,
            'idle_accounts': idle_zero,
            'underperforming_accounts': underperforming,
            'idle_total_aud': round(idle_total_aud, 2),
            'underperforming_total_aud': round(underperf_total_aud, 2),
            'opportunity_monthly_aud': total_monthly_uplift,
            'opportunity_yearly_aud': total_yearly_uplift,
            'top_move': top_move,
            'narrative': kimi_narrative,
            'narrative_provider': kimi_provider,
        }
        _RATE_WATCHER_CACHE['t'] = now
        _RATE_WATCHER_CACHE['data'] = data
        return data
    except Exception as e:
        logger.exception(f"rate-watcher failed: {e}")
        return {'error': str(e), 'as_of': datetime.utcnow().isoformat() + 'Z'}


# ============================================================================
# AI Project Cost Forecaster
#
# Wealth-coach tier-1 pick: on the Lind $700k build, a typical 20–30% cost
# overrun = $140k–210k hit to the 2030 retirement. Even catching half of that
# drift early is $70k+ saved. This endpoint combines:
#
#   1. Velocity analysis of actual transaction spend on each project vs its
#      declared budget (`wealth_plan.acacia_reno_remaining`, `lind_build_cost`).
#   2. Plan-date gap detection — if Acacia sale month or Lind build start/end
#      are null, the /api/plan/simulate endpoint silently models an
#      impossible-to-cover scenario (all spend, no offsetting sale) and shows
#      "insolvency" that isn't real.
#   3. Kimi narrative giving the user ONE action per project.
#
# Cached 10 min — velocity updates if user categorises a new txn, but Kimi
# costs money.
# ============================================================================
_PROJECT_FORECAST_CACHE: Dict[str, object] = {'t': 0.0, 'data': None}
_PROJECT_FORECAST_TTL = 600  # 10 min

@app.get("/api/intel/project-forecaster")
def api_project_forecaster(force: bool = False, cache_only: bool = False):
    """Velocity-based project cost forecast + plan-date sanity check + Kimi
    narrative. Powers the Projects-page forecaster card.

    `cache_only=True` → see `_with_cache_meta` docstring (Iteration 22)."""
    import time as _time
    now = _time.time()
    cached = _PROJECT_FORECAST_CACHE.get('data')
    ts = _PROJECT_FORECAST_CACHE.get('t') or 0
    if not force:
        if cached and (now - ts) < _PROJECT_FORECAST_TTL:
            return _with_cache_meta(cached, ts, now)
        if cache_only:
            if cached:
                return _with_cache_meta(cached, ts, now, stale=True)
            return {'cached': False}

    _, fx = _fx_cache()
    try:
        with get_db_connection() as conn:
            plan = dict(conn.execute("SELECT * FROM wealth_plan WHERE id = 1").fetchone() or {})
            projects = conn.execute(
                "SELECT id, name, kind, started_at, completed_at, sale_price FROM projects ORDER BY id"
            ).fetchall()

            forecasts: List[Dict] = []
            plan_gaps: List[str] = []

            for p in projects:
                pid = p['id']
                name = p['name']

                # Resolve the budget — the `projects` table doesn't carry a
                # budget column. Authoritative numbers live on the
                # `wealth_plan` row: `acacia_reno_remaining` (delta to go) +
                # spent-to-date for Acacia, `lind_build_cost` for Lind.
                is_acacia = 'acacia' in name.lower()
                is_lind = 'lind' in name.lower()
                budget_source = 'unknown'
                budget_aud = 0.0

                if is_acacia:
                    reno_remaining = plan.get('acacia_reno_remaining') or 0
                    # Pull spent-to-date and add remaining to get total budget
                    spent_row = conn.execute(
                        """SELECT COALESCE(SUM(ABS(t.amount * COALESCE(fx.rate, 1))), 0) AS spent
                           FROM transactions t
                           LEFT JOIN fx_rates fx ON fx.from_currency = t.currency AND fx.to_currency = 'AUD'
                             AND fx.recorded_at = (
                               SELECT MAX(recorded_at) FROM fx_rates
                               WHERE from_currency = t.currency AND to_currency = 'AUD'
                             )
                           WHERE t.project_id = ? AND t.amount < 0 AND t.transaction_type != 'transfer'""",
                        (pid,),
                    ).fetchone()
                    spent_to_date = (spent_row['spent'] if spent_row else 0) or 0
                    budget_aud = spent_to_date + reno_remaining
                    budget_source = 'spent_to_date + acacia_reno_remaining'
                elif is_lind:
                    budget_aud = plan.get('lind_build_cost') or 0
                    budget_source = 'lind_build_cost'

                # Velocity stats — monthly spend last 30/90/365 days (AUD)
                def _windowed_spend(days: int) -> Tuple[float, int]:
                    r = conn.execute(
                        """SELECT COUNT(*) AS n, COALESCE(SUM(ABS(t.amount)), 0) AS amt
                           FROM transactions t
                           WHERE t.project_id = ? AND t.amount < 0
                             AND t.transaction_type != 'transfer'
                             AND t.transaction_date >= date('now', ?)""",
                        (pid, f'-{days} days'),
                    ).fetchone()
                    return (float(r['amt']) if r else 0.0, int(r['n']) if r else 0)

                amt_30, cnt_30 = _windowed_spend(30)
                amt_90, cnt_90 = _windowed_spend(90)
                amt_365, cnt_365 = _windowed_spend(365)

                # Total spent AUD (same figure that drives /api/plan/simulate.project_spend)
                tot_row = conn.execute(
                    """SELECT COUNT(*) AS n, COALESCE(SUM(ABS(t.amount)), 0) AS amt
                       FROM transactions t
                       WHERE t.project_id = ? AND t.amount < 0 AND t.transaction_type != 'transfer'""",
                    (pid,),
                ).fetchone()
                total_spent = float(tot_row['amt']) if tot_row else 0.0
                total_txns = int(tot_row['n']) if tot_row else 0

                pct_complete = (total_spent / budget_aud * 100) if budget_aud > 0 else 0
                remaining = max(0, budget_aud - total_spent)

                # Velocity: use 90d average per month as the forecasting rate —
                # more stable than 30d (noisy), more responsive than 365d.
                velocity_30 = amt_30      # 30d is effectively per-month
                velocity_90 = amt_90 / 3  # 3 months in 90 days
                velocity_best = velocity_30 if velocity_30 > 0 else velocity_90

                months_to_complete: Optional[float] = None
                if remaining > 0 and velocity_best > 0:
                    months_to_complete = round(remaining / velocity_best, 1)
                elif remaining == 0:
                    months_to_complete = 0.0

                # Overrun risk
                overrun_risk = 'unknown'
                if budget_aud > 0:
                    if total_spent > budget_aud * 1.05:
                        overrun_risk = 'over'
                    elif pct_complete >= 90:
                        overrun_risk = 'finishing'
                    elif months_to_complete is not None and months_to_complete <= 6:
                        overrun_risk = 'on_track'
                    elif velocity_best > (budget_aud / 18):  # implies >budget in <18mo
                        overrun_risk = 'hot_burn'
                    else:
                        overrun_risk = 'early'

                # Plan-date gap detection
                date_gaps: List[str] = []
                if is_acacia and not plan.get('acacia_target_sale_month'):
                    date_gaps.append('acacia_target_sale_month is NULL — sim models the reno spend but never the $450k sale income')
                if is_lind and not plan.get('lind_build_start_month'):
                    date_gaps.append('lind_build_start_month is NULL — sim spreads the $700k build cost generically')
                if is_lind and not plan.get('lind_build_end_month'):
                    date_gaps.append('lind_build_end_month is NULL')
                if is_lind and plan.get('lind_target_sale_month') and not str(plan.get('lind_target_sale_month')).startswith('20') and len(str(plan.get('lind_target_sale_month'))) < 7:
                    date_gaps.append(f"lind_target_sale_month is '{plan.get('lind_target_sale_month')}' — no month specified, defaults to December")

                # Derive status from started_at / completed_at
                status = 'complete' if p['completed_at'] else ('active' if p['started_at'] else 'planned')
                if is_lind and not p['started_at']:
                    status = 'planned'

                forecasts.append({
                    'project_id': pid,
                    'name': name,
                    'kind': p['kind'],
                    'started_at': p['started_at'],
                    'completed_at': p['completed_at'],
                    'status': status,
                    'budget_aud': round(budget_aud, 2),
                    'budget_source': budget_source,
                    'spent_to_date': round(total_spent, 2),
                    'transaction_count': total_txns,
                    'pct_complete': round(pct_complete, 1),
                    'remaining_aud': round(remaining, 2),
                    'velocity_30d_per_mo': round(velocity_30, 2),
                    'velocity_90d_per_mo': round(velocity_90, 2),
                    'txns_30d': cnt_30,
                    'txns_90d': cnt_90,
                    'implied_months_to_complete': months_to_complete,
                    'overrun_risk': overrun_risk,
                    'date_gaps': date_gaps,
                })
                plan_gaps.extend(date_gaps)

        total_budget = sum(f['budget_aud'] for f in forecasts)
        total_spent = sum(f['spent_to_date'] for f in forecasts)
        total_remaining = sum(f['remaining_aud'] for f in forecasts)

        # Kimi narrative
        narrative: Optional[str] = None
        provider = 'kimi'
        try:
            lines = '\n'.join(
                f"  · {f['name']}: spent ${f['spent_to_date']:,.0f} of ${f['budget_aud']:,.0f} budget "
                f"({f['pct_complete']:.0f}% complete, {f['transaction_count']} txns); "
                f"30d velocity ${f['velocity_30d_per_mo']:,.0f}/mo, 90d ${f['velocity_90d_per_mo']:,.0f}/mo; "
                f"{f['implied_months_to_complete']} months to complete at current rate; "
                f"risk tag: {f['overrun_risk']}"
                for f in forecasts
            )
            gap_lines = '\n'.join(f"  · {g}" for g in plan_gaps) if plan_gaps else '  · none'
            system = (
                "You are a no-nonsense project-cost advisor for Christopher & Nicole, who are in drawdown and "
                "building toward a 2030 Tasmania retirement. The Acacia reno ($88k total, almost done) funds the "
                "Lind build ($700k, not started), which funds retirement via a $2.4M sale in 2028. Any overrun "
                "compounds. Be direct. Numbers every sentence. No disclaimers. Under 120 words."
            )
            user = (
                f"PROJECTS (live velocity):\n{lines}\n\n"
                f"PLAN DATE GAPS (why /api/plan/simulate might show false insolvency):\n{gap_lines}\n\n"
                f"TOTALS: budget ${total_budget:,.0f}, spent ${total_spent:,.0f}, remaining ${total_remaining:,.0f}.\n\n"
                "Give ONE paragraph: (1) the single most important project status update, (2) "
                "the single action to take this week, (3) any data-gap the user must close in the Plan page."
            )
            narrative = _kimi_chat(system, user, max_tokens=4000, temperature=1)
        except Exception as e:
            logger.warning(f"project-forecaster Kimi call failed: {e}")
            narrative = None

        if not narrative:
            # Deterministic fallback
            lead = forecasts[0] if forecasts else None
            if lead:
                narrative = (
                    f"{lead['name']}: ${lead['spent_to_date']:,.0f} of ${lead['budget_aud']:,.0f} budget "
                    f"({lead['pct_complete']:.0f}% complete). "
                    f"At current ${lead['velocity_30d_per_mo']:,.0f}/mo velocity, "
                    f"{lead['implied_months_to_complete']} months to complete."
                )
                if plan_gaps:
                    narrative += f" Plan needs: {plan_gaps[0]}"
            else:
                narrative = "No projects found."
            provider = 'fallback'

        data = {
            'as_of': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
            'projects': forecasts,
            'plan_gaps': plan_gaps,
            'total_budget_aud': round(total_budget, 2),
            'total_spent_aud': round(total_spent, 2),
            'total_remaining_aud': round(total_remaining, 2),
            'narrative': narrative,
            'narrative_provider': provider,
        }
        _PROJECT_FORECAST_CACHE['t'] = now
        _PROJECT_FORECAST_CACHE['data'] = data
        return data
    except Exception as e:
        logger.exception(f"project-forecaster failed: {e}")
        return {'error': str(e), 'as_of': datetime.utcnow().isoformat() + 'Z'}


# ============================================================================
# AI Plan Stress-tester
#
# Tier-1 impact (wealth-coach backlog #1). Runs the existing plan simulator
# under a fixed panel of stress scenarios using its override parameters, then
# asks Kimi to identify the single weakest link and the most leverage-worthy
# action the user could take this week to reduce tail risk.
#
# Scenarios (fixed v1 — editable without schema changes):
#   1. Baseline (no overrides)
#   2. Lind build cost +20% (construction overrun)
#   3. Acacia sale -15% (market soft)
#   4. Lind sale delayed +12 months
#   5. Combined bear (all three above)
#   6. Bull case (Acacia +10%, Lind +15%, Lind cost -5%)
#
# Cached 15 min. Invoking plan-sim six times per refresh.
# ============================================================================
_PLAN_STRESS_CACHE: Dict[str, object] = {'t': 0.0, 'data': None}
_PLAN_STRESS_TTL = 900  # 15 min

@app.get("/api/intel/plan-stress")
def api_plan_stress(force: bool = False, cache_only: bool = False):
    """Multi-scenario plan stress-test + Kimi narrative on tail risk.

    `cache_only=True` → see `_with_cache_meta` docstring (Iteration 22)."""
    import time as _time
    now = _time.time()
    cached = _PLAN_STRESS_CACHE.get('data')
    ts = _PLAN_STRESS_CACHE.get('t') or 0
    if not force:
        if cached and (now - ts) < _PLAN_STRESS_TTL:
            return _with_cache_meta(cached, ts, now)
        if cache_only:
            if cached:
                return _with_cache_meta(cached, ts, now, stale=True)
            return {'cached': False}

    try:
        with get_db_connection() as conn:
            plan_row = conn.execute("SELECT * FROM wealth_plan WHERE id = 1").fetchone()
        plan = dict(plan_row) if plan_row else {}
        base_acacia = plan.get('acacia_target_sale_price') or 450000
        base_lind_sale = plan.get('lind_target_sale_price') or 2400000
        base_lind_cost = plan.get('lind_build_cost') or 700000

        scenarios = [
            {'key': 'baseline',     'label': 'Baseline', 'desc': 'Current plan as entered', 'overrides': {}},
            {'key': 'lind_overrun', 'label': 'Lind +20% overrun',   'desc': 'Construction costs blow out 20%',
             'overrides': {'lind_build_cost_override': round(base_lind_cost * 1.20, 0)}},
            {'key': 'acacia_soft',  'label': 'Acacia soft -15%',    'desc': 'Acacia market softens, sale 15% below target',
             'overrides': {'acacia_sale_price_override': round(base_acacia * 0.85, 0)}},
            {'key': 'lind_delay',   'label': 'Lind sale +12mo',     'desc': 'Lind sale delayed 12 months',
             'overrides': {'lind_sale_month_delta': 12}},
            {'key': 'bear',         'label': 'Combined bear',       'desc': 'Lind overrun + Acacia soft + Lind delay together',
             'overrides': {
                 'lind_build_cost_override': round(base_lind_cost * 1.20, 0),
                 'acacia_sale_price_override': round(base_acacia * 0.85, 0),
                 'lind_sale_month_delta': 12,
             }},
            {'key': 'bull',         'label': 'Bull case',           'desc': 'Acacia strong +10%, Lind +15%, cost -5%',
             'overrides': {
                 'acacia_sale_price_override': round(base_acacia * 1.10, 0),
                 'lind_sale_price_override': round(base_lind_sale * 1.15, 0),
                 'lind_build_cost_override': round(base_lind_cost * 0.95, 0),
             }},
        ]

        results = []
        for s in scenarios:
            try:
                sim = api_plan_simulate(**s['overrides'])
                if not isinstance(sim, dict):
                    continue
                warnings = sim.get('warnings') or []
                first_break = next((w for w in warnings if w.get('status') == 'break'), None)
                results.append({
                    'key': s['key'],
                    'label': s['label'],
                    'desc': s['desc'],
                    'overrides': s['overrides'],
                    'min_cash': sim.get('min_cash'),
                    'min_cash_month': sim.get('min_cash_month'),
                    'ending_cash': sim.get('ending_cash'),
                    'warnings_count': len(warnings),
                    'break_count': sum(1 for w in warnings if w.get('status') == 'break'),
                    'tight_count': sum(1 for w in warnings if w.get('status') == 'tight'),
                    'first_break_month': first_break.get('month') if first_break else None,
                    'first_break_cash': first_break.get('cash') if first_break else None,
                    'retire_month': sim.get('retire_month'),
                    'health': sim.get('health'),
                })
            except Exception as se:
                logger.warning(f"stress scenario {s['key']} failed: {se}")
                continue

        baseline = next((r for r in results if r['key'] == 'baseline'), None)
        bear = next((r for r in results if r['key'] == 'bear'), None)
        break_scenarios = [r for r in results if r['break_count'] > 0]
        worst = min(results, key=lambda r: (r['min_cash'] if r['min_cash'] is not None else 0), default=None)

        # Kimi narrative
        narrative: Optional[str] = None
        provider = 'kimi'
        try:
            rows = '\n'.join(
                f"  · {r['label']:<22} min_cash ${ (r['min_cash'] or 0):>12,.0f} in {r['min_cash_month'] or '?'}"
                f"  ending ${ (r['ending_cash'] or 0):>12,.0f}"
                f"  warnings {r['warnings_count']}/{r['break_count']}b  health {r['health'] or '?'}"
                for r in results
            )
            system = (
                "You are a tail-risk analyst for Christopher & Nicole's path to 2030 Tasmania retirement. "
                "Their plan: finish Acacia reno ~$88k, sell Acacia (~$450k), build Lind ($700k), sell Lind "
                "2028 ($2.4M), retire. They are in drawdown. Be direct. Numbers every sentence. Under 130 words."
            )
            user = (
                f"SCENARIO STRESS RESULTS (from /api/plan/simulate overrides):\n{rows}\n\n"
                f"Baseline ending cash: ${(baseline['ending_cash'] if baseline else 0):,.0f}\n"
                f"Worst scenario: {worst['label'] if worst else '?'} — min cash ${(worst['min_cash'] if worst else 0):,.0f}\n"
                f"{len(break_scenarios)} of {len(results)} scenarios show cash breaking zero.\n\n"
                "Give ONE paragraph: (1) the single biggest tail risk revealed, (2) the one pre-emptive action "
                "that reduces the most tail risk per dollar of effort, (3) which scenario should they treat as "
                "'planning-case' (not baseline) given their drawdown posture."
            )
            narrative = _kimi_chat(system, user, max_tokens=5000, temperature=1)
        except Exception as e:
            logger.warning(f"plan-stress Kimi call failed: {e}")
            narrative = None

        if not narrative:
            if bear and (bear['min_cash'] or 0) < 0:
                narrative = (
                    f"Combined bear case shows cash ${bear['min_cash']:,.0f} in {bear['min_cash_month']}. "
                    f"Most sensitive input: Lind build cost — every 10% overrun on the $700k build pushes the "
                    f"trough {abs((bear['min_cash'] or 0) - (baseline['min_cash'] or 0))/10000:.0f}k deeper. "
                    f"Lock in the Lind builder contract with a fixed-price clause before breaking ground."
                )
                provider = 'fallback'
            else:
                narrative = "All stress scenarios hold above zero. Current plan is robust to single-variable shocks."
                provider = 'fallback'

        data = {
            'as_of': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
            'scenarios': results,
            'baseline_ending_cash': baseline['ending_cash'] if baseline else None,
            'bear_ending_cash': bear['ending_cash'] if bear else None,
            'worst_min_cash': worst['min_cash'] if worst else None,
            'worst_scenario_key': worst['key'] if worst else None,
            'break_scenario_count': len(break_scenarios),
            'total_scenario_count': len(results),
            'narrative': narrative,
            'narrative_provider': provider,
        }
        _PLAN_STRESS_CACHE['t'] = now
        _PLAN_STRESS_CACHE['data'] = data
        return data
    except Exception as e:
        logger.exception(f"plan-stress failed: {e}")
        return {'error': str(e), 'as_of': datetime.utcnow().isoformat() + 'Z'}


# ============================================================================
# AI Financial Advisor Rebuke Ribbon
#
# Accountability layer. Calls out opportunities that have been flagged for
# ≥7 days and the user hasn't acted on. Voice = senior fiduciary advisor, NOT
# a contrarian. One surface (Dashboard ribbon), dismissible.
#
# Source of truth for active opportunities:
#   • Rate Watcher idle_accounts + underperforming_accounts
#   • Project Forecaster plan_gaps (null Acacia sale / Lind dates)
#   • Advisor Recs severity ∈ {'high','critical'}
#
# Dedup key: (source_kind, source_ref).  New items get first_flagged=now.
# When the underlying source stops reporting the item (user acted), we set
# acted_at=now and the rebuke disappears.  Explicit dismissal sets
# dismissed_at + reason.
# ============================================================================
_REBUKE_KIMI_CACHE: Dict[str, Dict] = {}   # key: f"{kind}|{ref}|{week_bucket}" -> {'t', 'text'}
_REBUKE_KIMI_TTL = 3600                     # 1h
_REBUKE_MIN_DAYS = 7
_REBUKE_MIN_AUD_PER_MO = 20.0              # filter dust
_REBUKE_SEVERITY_BUCKETS = (7, 14, 28)     # days: attention / warning / critical

def _rebuke_severity(days: int) -> str:
    if days >= _REBUKE_SEVERITY_BUCKETS[2]:
        return 'critical'
    if days >= _REBUKE_SEVERITY_BUCKETS[1]:
        return 'warning'
    return 'attention'


def _rebuke_kimi_voice(title: str, days: int, opp_per_mo: float, opp_total_lost: float) -> Optional[str]:
    """The soul of the feature. A senior fiduciary advisor voice — NOT a
    contrarian. Terse, caring, dollar-grounded, no moralising."""
    cache_key = f"{title}|{days // 7}|{round(opp_per_mo, -1)}"
    cached = _REBUKE_KIMI_CACHE.get(cache_key)
    import time as _time
    now = _time.time()
    if cached and (now - cached['t']) < _REBUKE_KIMI_TTL:
        return cached['text']

    system = (
        "You are the AI financial advisor for Christopher & Nicole Howell, a couple "
        "in drawdown mode heading to 2030 Tasmania retirement. You have fiduciary "
        "responsibility and have been tracking their position for months.\n\n"
        f"Your job right now is to call out ONE opportunity they flagged {days} days "
        f"ago and still haven't acted on. Cost of the delay: ${opp_per_mo:,.0f}/month "
        f"(${opp_total_lost:,.0f} already foregone).\n\n"
        "Write ONE sentence, max 25 words, as their advisor.\n"
        "- Direct but caring.\n"
        "- Always quantify the delay cost in dollars.\n"
        "- Never lecture. Never moralise. Never use 'should'.\n"
        "- Either ask what's blocking (if there might be a genuine reason) or state "
        "  the specific next step plainly.\n\n"
        "Tone anchors:\n"
        "✓ \"You're 12 days into a $684/mo bleed on the JPY account — the move takes "
        "90 seconds. What's the holdup?\"\n"
        "✓ \"Three weeks, $2,052 gone. Either Rabo's a worse choice than I think, "
        "or this is just friction. Which is it?\"\n"
        "✓ \"The Lind build-start date is still blank, and every week it stays blank "
        "costs you confidence in the 2030 plan. 10 minutes in Settings, then a "
        "fresh sim.\"\n"
        "✗ \"You really should move this money, it's important.\"\n"
        "✗ \"Another week without moving the JPY. Disappointing.\"\n\n"
        "Return ONLY the sentence. No preamble. No quotes around it."
    )
    user = (
        f"ITEM: {title}\n"
        f"FIRST FLAGGED: {days} days ago\n"
        f"DELAY COST: ${opp_per_mo:,.0f}/mo"
    )
    try:
        out = _kimi_chat(system, user, max_tokens=3000, temperature=1)
        if out:
            text = out.strip().strip('"').strip("'")
            _REBUKE_KIMI_CACHE[cache_key] = {'t': now, 'text': text}
            return text
    except Exception as e:
        logger.warning(f"rebuke Kimi call failed: {e}")
    return None


def _rebuke_active_opportunities() -> List[Dict]:
    """Pull current active opportunities from the three source endpoints.
    Each returned item has: source_kind, source_ref, title, opportunity_aud_per_mo,
    action_link, action_label."""
    items: List[Dict] = []

    # Source 1: Rate Watcher — idle 0% accounts + underperforming accounts
    try:
        rw = api_rate_watcher()
        for a in rw.get('idle_accounts', []) or []:
            mo = a.get('monthly_uplift_aud') or 0
            if mo < _REBUKE_MIN_AUD_PER_MO:
                continue
            items.append({
                'source_kind': 'rate-watcher',
                'source_ref': f"account:{a.get('id')}",
                'title': f"{a.get('name')} sitting at {a.get('apy', 0):.2f}% APY (${a.get('balance_aud', 0):,.0f})",
                'opportunity_aud_per_mo': float(mo),
                'action_link': '/advisor',
                'action_label': 'Open Rate Watcher',
            })
        for a in rw.get('underperforming_accounts', []) or []:
            mo = a.get('monthly_uplift_aud') or 0
            if mo < _REBUKE_MIN_AUD_PER_MO:
                continue
            items.append({
                'source_kind': 'rate-watcher',
                'source_ref': f"account:{a.get('id')}",
                'title': f"{a.get('name')} at {a.get('apy', 0):.2f}% vs market ceiling {rw.get('market_ceiling_apy', 0):.2f}%",
                'opportunity_aud_per_mo': float(mo),
                'action_link': '/advisor',
                'action_label': 'Open Rate Watcher',
            })
    except Exception as e:
        logger.warning(f"rebuke: rate-watcher pull failed: {e}")

    # Source 2: Project Forecaster — plan-date gaps
    try:
        pf = api_project_forecaster()
        for gap in pf.get('plan_gaps', []) or []:
            # Derive a stable ref from the field name inside the gap text
            gap_text = str(gap)
            ref = 'unknown'
            for field in ('acacia_target_sale_month', 'lind_build_start_month',
                          'lind_build_end_month', 'lind_target_sale_month'):
                if field in gap_text:
                    ref = field
                    break
            items.append({
                'source_kind': 'plan-gap',
                'source_ref': f"plan-field:{ref}",
                'title': gap_text.split('—')[0].strip() if '—' in gap_text else gap_text[:90],
                # Plan-date gaps aren't a monthly $ figure — use a fixed symbolic
                # cost-of-uncertainty so they still clear the min threshold and
                # the advisor prompt has something to reference.
                'opportunity_aud_per_mo': 200.0,
                'action_link': '/plan',
                'action_label': 'Open Plan',
            })
    except Exception as e:
        logger.warning(f"rebuke: project-forecaster pull failed: {e}")

    # Source 3: Advisor Recs — severity high/critical
    try:
        # Import-time: advisor_engine is already imported elsewhere
        from advisor_engine import build_recommendations
        _, fx = _fx_cache()
        nw = _net_worth_breakdown_aud()
        with get_db_connection() as conn:
            recs = build_recommendations(conn, fx, nw['net_worth_aud'])
        for r in (recs.get('recommendations') or []):
            sev = str(r.get('severity', '')).lower()
            if sev not in ('high', 'critical'):
                continue
            impact_year = float(r.get('est_impact_aud_per_year') or 0)
            mo = impact_year / 12 if impact_year else _REBUKE_MIN_AUD_PER_MO
            if mo < _REBUKE_MIN_AUD_PER_MO:
                continue
            items.append({
                'source_kind': 'advisor-rec',
                'source_ref': f"rec:{r.get('id')}",
                'title': str(r.get('title', ''))[:120],
                'opportunity_aud_per_mo': mo,
                'action_link': '/advisor',
                'action_label': 'Open Advisor',
            })
    except Exception as e:
        logger.warning(f"rebuke: advisor-recs pull failed: {e}")

    # Dedup by (source_kind, source_ref) in case the same ref appears twice
    seen: set = set()
    deduped: List[Dict] = []
    for it in items:
        k = (it['source_kind'], it['source_ref'])
        if k in seen:
            continue
        seen.add(k)
        deduped.append(it)
    return deduped


_REBUKE_CACHE: Dict[str, object] = {'t': 0.0, 'data': None}
_REBUKE_TTL = 300  # 5min — rebuke composition involves multiple Kimi calls
                   # (one per active item). Caching keeps the Dashboard
                   # mount fast on rapid reloads.


@app.get("/api/intel/rebuke")
def api_rebuke(force: bool = False):
    """Active rebuke list. Dedup against rebuke_log, upsert first_flagged for
    new items, auto-mark items as acted when source no longer reports them,
    then filter to items ≥7 days old that haven't been dismissed.
    Seeds first_flagged 8 days in the past on a fresh DB so the feature
    surfaces existing long-standing opportunities immediately.

    Iteration 23 perf fix: caches the full response (including Kimi-narrated
    rebukes) for 5 minutes. The dashboard's RebukeRibbon is the only AI
    surface that auto-fires on mount (kept by user choice); this cache makes
    that auto-fire effectively free on rapid reloads. `force=true` bypasses.
    """
    import time as _time
    now_ts = _time.time()
    if not force:
        cached = _REBUKE_CACHE.get('data')
        ts = _REBUKE_CACHE.get('t') or 0
        if cached and (now_ts - ts) < _REBUKE_TTL:
            return _with_cache_meta(cached, ts, now_ts)
    now_iso = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    active = _rebuke_active_opportunities()
    active_keys = {(it['source_kind'], it['source_ref']) for it in active}
    active_map = {(it['source_kind'], it['source_ref']): it for it in active}

    # Phase 1: OPEN conn, do all DB reads + upserts + acted-marks, SELECT the
    # eligible rows, COMMIT, CLOSE. Critical: the connection MUST be closed
    # before we call Kimi — otherwise the writer holds the DB while other
    # requests pile up waiting on the 60-second LLM round-trip.
    from datetime import timedelta
    cutoff_iso = (datetime.utcnow() - timedelta(days=_REBUKE_MIN_DAYS)).isoformat(timespec='seconds') + 'Z'
    eligible_rows: List[sqlite3.Row] = []
    row_ids_to_mark_rebuked: List[int] = []
    with get_db_connection() as conn:
        existing_count_row = conn.execute("SELECT COUNT(*) AS n FROM rebuke_log").fetchone()
        fresh_db = (existing_count_row['n'] if existing_count_row else 0) == 0

        seed_flagged = None
        if fresh_db and active:
            # Seed first_flagged 8 days ago on fresh DB so items appear
            # immediately on first Dashboard visit (matches reality — these
            # opportunities have been flagged via Rate Watcher for weeks).
            seed_flagged = (datetime.utcnow() - timedelta(days=8)).isoformat(timespec='seconds') + 'Z'

        for it in active:
            row = conn.execute(
                "SELECT id, first_flagged, dismissed_at FROM rebuke_log "
                "WHERE source_kind = ? AND source_ref = ?",
                (it['source_kind'], it['source_ref']),
            ).fetchone()
            if row is None:
                conn.execute(
                    "INSERT INTO rebuke_log (source_kind, source_ref, title, "
                    "opportunity_aud_per_mo, first_flagged, last_rebuked) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        it['source_kind'], it['source_ref'], it['title'],
                        it['opportunity_aud_per_mo'],
                        seed_flagged or now_iso,
                        now_iso,
                    ),
                )
            else:
                conn.execute(
                    "UPDATE rebuke_log SET title = ?, opportunity_aud_per_mo = ? "
                    "WHERE id = ?",
                    (it['title'], it['opportunity_aud_per_mo'], row['id']),
                )

        # Auto-mark items acted when no longer in the active source
        acted_now = conn.execute(
            "SELECT id, source_kind, source_ref FROM rebuke_log "
            "WHERE acted_at IS NULL AND dismissed_at IS NULL"
        ).fetchall()
        for r in acted_now:
            key = (r['source_kind'], r['source_ref'])
            if key not in active_keys:
                conn.execute("UPDATE rebuke_log SET acted_at = ? WHERE id = ?",
                             (now_iso, r['id']))

        # Select rows eligible to rebuke
        eligible_rows = conn.execute(
            "SELECT id, source_kind, source_ref, title, opportunity_aud_per_mo, "
            "       first_flagged "
            "FROM rebuke_log "
            "WHERE dismissed_at IS NULL AND acted_at IS NULL "
            "  AND first_flagged <= ? "
            "  AND COALESCE(opportunity_aud_per_mo, 0) >= ? "
            "ORDER BY opportunity_aud_per_mo DESC "
            "LIMIT 3",
            (cutoff_iso, _REBUKE_MIN_AUD_PER_MO),
        ).fetchall()

        conn.commit()
    # conn closed here — safe to do Kimi calls without holding write lock

    # Phase 2: Kimi calls (no DB connection open)
    rebukes: List[Dict] = []
    total_monthly_bleed = 0.0
    for r in eligible_rows:
        try:
            flagged = datetime.fromisoformat(r['first_flagged'].replace('Z', '+00:00'))
            days = max(0, (datetime.utcnow().replace(tzinfo=flagged.tzinfo) - flagged).days)
        except Exception:
            days = _REBUKE_MIN_DAYS
        opp_per_mo = float(r['opportunity_aud_per_mo'] or 0)
        months_flagged = days / 30.44
        total_wasted = round(opp_per_mo * months_flagged, 2)

        rebuke_text = _rebuke_kimi_voice(
            title=r['title'], days=days,
            opp_per_mo=opp_per_mo, opp_total_lost=total_wasted,
        )
        if not rebuke_text:
            rebuke_text = (
                f"{days} days in, ${opp_per_mo:,.0f}/mo still bleeding. What's the blocker?"
            )

        action_data = active_map.get((r['source_kind'], r['source_ref']), {})
        rebukes.append({
            'source_kind': r['source_kind'],
            'source_ref': r['source_ref'],
            'title': r['title'],
            'opportunity_aud_per_mo': round(opp_per_mo, 2),
            'opportunity_aud_total_wasted': total_wasted,
            'days_since_flagged': days,
            'severity': _rebuke_severity(days),
            'rebuke': rebuke_text,
            'action_link': action_data.get('action_link', '/advisor'),
            'action_label': action_data.get('action_label', 'Act'),
        })
        total_monthly_bleed += opp_per_mo
        row_ids_to_mark_rebuked.append(r['id'])

    # Phase 3: brief DB write to record last_rebuked. Separate connection —
    # short-lived, no Kimi inside.
    if row_ids_to_mark_rebuked:
        try:
            with get_db_connection() as conn:
                placeholders = ','.join('?' * len(row_ids_to_mark_rebuked))
                conn.execute(
                    f"UPDATE rebuke_log SET last_rebuked = ? WHERE id IN ({placeholders})",
                    [now_iso, *row_ids_to_mark_rebuked],
                )
                conn.commit()
        except sqlite3.OperationalError as e:
            logger.warning(f"rebuke last_rebuked update skipped: {e}")

    result = {
        'rebukes': rebukes,
        'total_monthly_bleed': round(total_monthly_bleed, 2),
        'as_of': now_iso,
    }
    _REBUKE_CACHE['t'] = now_ts
    _REBUKE_CACHE['data'] = result
    return _with_cache_meta(result, now_ts, now_ts)


class RebukeDismissIn(BaseModel):
    source_kind: str
    source_ref: str
    reason: Optional[str] = None


@app.post("/api/intel/rebuke/dismiss")
def api_rebuke_dismiss(inp: RebukeDismissIn):
    """User-initiated dismiss. Sets dismissed_at + optional reason.
    Returns the updated row (or 404 if not found)."""
    now_iso = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    with get_db_connection() as conn:
        cur = conn.execute(
            "UPDATE rebuke_log SET dismissed_at = ?, dismissed_reason = ? "
            "WHERE source_kind = ? AND source_ref = ? "
            "  AND dismissed_at IS NULL",
            (now_iso, inp.reason, inp.source_kind, inp.source_ref),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="rebuke not found or already dismissed")
        conn.commit()
        row = conn.execute(
            "SELECT * FROM rebuke_log WHERE source_kind = ? AND source_ref = ?",
            (inp.source_kind, inp.source_ref),
        ).fetchone()
    # Bust the rebuke cache so the dismissed item disappears immediately on
    # the next list fetch (Iteration 23 — without this, dismissed items would
    # linger for up to 5 minutes until the cache TTL expired).
    _REBUKE_CACHE['t'] = 0.0
    _REBUKE_CACHE['data'] = None
    return dict(row) if row else {'dismissed_at': now_iso}


# ============================================================================
# AI Negotiation Drafts
#
# Converts the Rate Watcher's insights into an actual, sendable email draft:
#
#   kind = 'rate-match'     — retention letter to the user's CURRENT bank
#                             asking for a match on a competitor's rate,
#                             implying a move otherwise.  Zero-cost ask on
#                             balances already held.
#   kind = 'consolidation'  — opener to a TARGET bank inquiring about opening
#                             an account and moving ~$X for a higher rate.
#   kind = 'move'           — for 0% APY accounts (Wise JPY) that cannot be
#                             "rate-matched", generate a confirmation-oriented
#                             note stating the move intent and asking about
#                             any fees / transfer timing.
#
# Kimi-driven; falls back to a deterministic template when the LLM is down.
# ============================================================================

class NegotiationDraftIn(BaseModel):
    kind: str = Field('rate-match', pattern='^(rate-match|consolidation|move)$')
    account_id: Optional[int] = None
    account_name: Optional[str] = None        # free-form fallback
    balance_aud: Optional[float] = None        # if account_id not provided
    current_apy: Optional[float] = None
    current_provider: Optional[str] = None
    target_provider: str
    target_apy: float
    user_name: Optional[str] = 'Christopher Howell'
    extra_context: Optional[str] = None


@app.post("/api/intel/negotiation-draft")
def api_negotiation_draft(inp: NegotiationDraftIn):
    """Generate an email draft (subject + body) for a bank negotiation or move."""
    _, fx = _fx_cache()
    try:
        balance_aud = inp.balance_aud
        current_apy = inp.current_apy
        current_provider = inp.current_provider
        account_name = inp.account_name

        # Resolve from account_id if provided
        if inp.account_id:
            with get_db_connection() as conn:
                r = conn.execute(
                    "SELECT id, name, currency, current_balance, institution, COALESCE(apy, 0) AS apy "
                    "FROM accounts WHERE id = ?",
                    (inp.account_id,),
                ).fetchone()
            if r:
                account_name = account_name or r['name']
                current_provider = current_provider or r['institution'] or r['name']
                current_apy = current_apy if current_apy is not None else (r['apy'] or 0)
                balance_aud = balance_aud or round((r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD'), 2)

        # Sensible fallbacks
        balance_aud = balance_aud or 0
        current_apy = current_apy or 0
        current_provider = current_provider or 'your bank'
        account_name = account_name or 'my savings account'

        monthly_delta = round(balance_aud * max(0, inp.target_apy - current_apy) / 100.0 / 12.0, 2)
        yearly_delta = round(monthly_delta * 12, 2)

        # Build Kimi prompt
        if inp.kind == 'rate-match':
            system = (
                "You draft short, confident retention-letter emails to Australian banks on behalf of "
                "Christopher & Nicole Howell.  Tone: direct, numbers-led, professional but not grovelling. "
                "They hold real money with the bank and expect a rate match or they will move.  "
                "Australian English spelling. No disclaimers."
            )
            user = (
                f"Draft a retention email to {current_provider} about {account_name} "
                f"(balance ${balance_aud:,.0f} AUD currently earning {current_apy:.2f}% APY). "
                f"Point out that {inp.target_provider} currently offers {inp.target_apy:.2f}% on a comparable product — "
                f"a gap worth ${monthly_delta:,.0f}/mo (${yearly_delta:,.0f}/yr) on this balance. "
                f"Ask them to match the rate. State that otherwise the balance will be moved within the next 30 days. "
                f"Sign off as {inp.user_name}. "
                f"{('Extra context: ' + inp.extra_context) if inp.extra_context else ''}"
                "\n\nReturn ONLY the email.  Format:\nSubject: …\n\n<body>"
            )
        elif inp.kind == 'consolidation':
            system = (
                "You draft short, polite inquiry emails to Australian banks on behalf of Christopher & Nicole Howell. "
                "Tone: warm but brisk, numbers-led.  The user is comparing options and wants to know eligibility, "
                "hoop requirements, and confirm the advertised rate is current.  Australian English. No disclaimers."
            )
            user = (
                f"Draft an inquiry email to {inp.target_provider} asking about opening {account_name} "
                f"(tentative balance ${balance_aud:,.0f} AUD) at their advertised {inp.target_apy:.2f}% rate. "
                f"Ask them to confirm: (1) the rate is current, (2) any ongoing conditions (monthly deposit, balance growth, "
                f"hoop transactions), and (3) expected transfer timing from another AU bank. "
                f"Sign off as {inp.user_name}. "
                f"{('Extra context: ' + inp.extra_context) if inp.extra_context else ''}"
                "\n\nReturn ONLY the email.  Format:\nSubject: …\n\n<body>"
            )
        else:  # move
            system = (
                "You draft short, practical operational emails to Australian banks confirming outgoing transfers. "
                "Tone: brief, polite, transactional.  Australian English.  No disclaimers."
            )
            user = (
                f"Draft an email to {current_provider} confirming intent to move "
                f"${balance_aud:,.0f} AUD out of {account_name} (currently earning {current_apy:.2f}%) to "
                f"{inp.target_provider} at {inp.target_apy:.2f}% APY "
                f"(yield gap: ${monthly_delta:,.0f}/mo = ${yearly_delta:,.0f}/yr). "
                f"Ask about expected transfer timing and any outgoing fees or FX conversion if applicable. "
                f"Sign off as {inp.user_name}. "
                f"{('Extra context: ' + inp.extra_context) if inp.extra_context else ''}"
                "\n\nReturn ONLY the email.  Format:\nSubject: …\n\n<body>"
            )

        subject: Optional[str] = None
        body: Optional[str] = None
        provider = 'kimi'
        try:
            raw = _kimi_chat(system, user, max_tokens=6000, temperature=1)
            if raw:
                # Parse "Subject: ...\n\n<body>"
                s = raw.strip()
                if s.lower().startswith('subject:'):
                    parts = s.split('\n', 1)
                    subject = parts[0][len('Subject:'):].strip()
                    body = parts[1].lstrip('\n').strip() if len(parts) > 1 else ''
                else:
                    subject = (
                        f"Rate-match request — {account_name} @ {current_apy:.2f}% vs market {inp.target_apy:.2f}%"
                        if inp.kind == 'rate-match' else
                        f"New account inquiry — {inp.target_apy:.2f}% savings product"
                        if inp.kind == 'consolidation' else
                        f"Outgoing transfer — ${balance_aud:,.0f} AUD from {account_name}"
                    )
                    body = s
        except Exception as e:
            logger.warning(f"negotiation-draft Kimi call failed: {e}")

        if not subject or not body:
            provider = 'fallback'
            if inp.kind == 'rate-match':
                subject = f"Rate-match request — {account_name}"
                body = (
                    f"Hi {current_provider},\n\n"
                    f"I hold ${balance_aud:,.0f} AUD in {account_name}, currently earning {current_apy:.2f}% APY.\n\n"
                    f"I've confirmed that {inp.target_provider} is currently offering {inp.target_apy:.2f}% on a comparable product. "
                    f"The gap is worth ${monthly_delta:,.0f}/mo (${yearly_delta:,.0f}/yr) on this balance.\n\n"
                    f"I'd like to give you the opportunity to match that rate before I transfer the funds. Can you please "
                    f"confirm within the next 7 days whether you can match {inp.target_apy:.2f}%?\n\n"
                    f"If not, I'll initiate the transfer in the following 30 days.\n\n"
                    f"Regards,\n{inp.user_name}"
                )
            elif inp.kind == 'consolidation':
                subject = f"Inquiry — {inp.target_apy:.2f}% savings product"
                body = (
                    f"Hi {inp.target_provider},\n\n"
                    f"I'd like to confirm a few details before opening an account:\n\n"
                    f"1. Is the advertised {inp.target_apy:.2f}% APY still current?\n"
                    f"2. What ongoing conditions apply (monthly deposit minimums, balance growth, linked debit card usage, hoop transactions)?\n"
                    f"3. Tentative balance would be around ${balance_aud:,.0f} AUD. Any tier-cap at which the rate drops?\n"
                    f"4. Expected transfer timing from another AU savings account?\n\n"
                    f"Regards,\n{inp.user_name}"
                )
            else:
                subject = f"Outgoing transfer — ${balance_aud:,.0f} AUD from {account_name}"
                body = (
                    f"Hi {current_provider},\n\n"
                    f"I'll be moving ${balance_aud:,.0f} AUD out of {account_name} to {inp.target_provider} at {inp.target_apy:.2f}%. "
                    f"The gap is worth ${monthly_delta:,.0f}/mo on this balance.\n\n"
                    f"Can you confirm (a) expected transfer timing and (b) any outgoing fees / FX conversion details?\n\n"
                    f"Regards,\n{inp.user_name}"
                )

        return {
            'kind': inp.kind,
            'subject': subject,
            'body': body,
            'provider': provider,
            'opportunity_monthly_aud': monthly_delta,
            'opportunity_yearly_aud': yearly_delta,
            'as_of': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
        }
    except Exception as e:
        logger.exception(f"negotiation-draft failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# AI Plan Health Score
#
# Single composite number 0-100 that compresses survival + income + plan + action
# into one glanceable metric. Four weighted components:
#
#   Survival   (40 pts) — cash buffer in months of living burn
#   Income     (25 pts) — net monthly surplus vs living burn
#   Plan       (20 pts) — plan-sim health (green/amber/red) + completeness
#   Action     (15 pts) — inverse of unresolved rebuke_log items
#
# No Kimi cost — pure computed metric. Frontend can show just the number OR
# expand to show the component breakdown. Cached 5min.
# ============================================================================
_HEALTH_SCORE_CACHE: Dict[str, object] = {'t': 0.0, 'data': None}
_HEALTH_SCORE_TTL = 300  # 5 min


def _score_survival(cash_aud: float, monthly_burn: float) -> Tuple[float, str]:
    """Return (points_0_to_40, label)."""
    if monthly_burn <= 0:
        return 40.0, 'infinite buffer (income covers burn)'
    months = cash_aud / monthly_burn
    if months >= 24:
        return 40.0, f'{months:.0f} months buffer — extremely robust'
    if months >= 12:
        # Linear 20..40 across 12..24
        pts = 20 + (months - 12) / 12 * 20
        return round(pts, 1), f'{months:.0f} months buffer — comfortable'
    if months >= 6:
        pts = 10 + (months - 6) / 6 * 10
        return round(pts, 1), f'{months:.0f} months buffer — below 12mo comfort line'
    pts = max(0, months / 6 * 10)
    return round(pts, 1), f'{months:.0f} months buffer — critical'


def _score_income(net_monthly: float, burn_monthly: float) -> Tuple[float, str]:
    """Net/mo surplus as a % of burn. Return (points_0_to_25, label)."""
    if net_monthly >= 2000:
        return 25.0, f'+${net_monthly:,.0f}/mo surplus — very strong'
    if net_monthly >= 500:
        pts = 15 + (net_monthly - 500) / 1500 * 10
        return round(pts, 1), f'+${net_monthly:,.0f}/mo surplus — solid'
    if net_monthly >= 0:
        pts = 10 + net_monthly / 500 * 5
        return round(pts, 1), f'+${net_monthly:,.0f}/mo — break-even territory'
    # Negative — scale 0-10 based on how deep
    if burn_monthly > 0:
        pct_burn = abs(net_monthly) / burn_monthly
        pts = max(0, 10 - pct_burn * 10)
    else:
        pts = 5
    return round(pts, 1), f'${net_monthly:,.0f}/mo — drawing from cash'


def _score_plan(plan_health: Optional[str], plan_completeness_status: Optional[str]) -> Tuple[float, str]:
    """Plan-sim health + completeness combined. Return (points_0_to_20, label)."""
    # 14 points for sim health, 6 for completeness
    sim_pts = {'green': 14, 'amber': 8, 'red': 2}.get(plan_health or '', 5)
    comp_pts = {'green': 6, 'amber': 3, 'red': 0}.get(plan_completeness_status or '', 0)
    total = sim_pts + comp_pts
    bits = []
    if sim_pts == 14: bits.append('sim green')
    elif sim_pts == 8: bits.append('sim amber')
    elif sim_pts == 2: bits.append('sim red')
    else:              bits.append('sim unknown')
    if comp_pts == 6: bits.append('plan complete')
    elif comp_pts == 3: bits.append('plan partly filled')
    elif comp_pts == 0: bits.append('plan has null dates')
    return float(total), ' · '.join(bits)


def _score_action(unresolved_rebukes: int) -> Tuple[float, str]:
    """Inverse of rebuke_log items >7d unresolved. Return (points_0_to_15, label)."""
    if unresolved_rebukes == 0:
        return 15.0, 'nothing left unactioned'
    if unresolved_rebukes <= 2:
        return 10.0, f'{unresolved_rebukes} item{"s" if unresolved_rebukes != 1 else ""} >7d unresolved'
    if unresolved_rebukes <= 5:
        return 5.0, f'{unresolved_rebukes} items >7d unresolved'
    return 0.0, f'{unresolved_rebukes} items >7d unresolved — cleanup overdue'


@app.get("/api/intel/plan-health-score")
def api_plan_health_score(force: bool = False):
    """Composite 0-100 plan health score with component breakdown. Pure compute
    from existing data — no Kimi calls, no network fetches."""
    import time as _time
    now = _time.time()
    if not force:
        cached = _HEALTH_SCORE_CACHE.get('data')
        ts = _HEALTH_SCORE_CACHE.get('t') or 0
        if cached and (now - ts) < _HEALTH_SCORE_TTL:
            return cached

    # Pull inputs — all cached/cheap paths only.
    _, fx = _fx_cache()
    with get_db_connection() as conn:
        # Cash + income direct SQL
        cash_rows = conn.execute(
            "SELECT current_balance, currency FROM accounts "
            "WHERE is_active = 1 AND type IN ('savings','checking')"
        ).fetchall()
        cash = sum((r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD')
                   for r in cash_rows)
        plan_row = conn.execute(
            "SELECT COALESCE(nicole_income_monthly_min, nicole_income_monthly, 0) AS n "
            "FROM wealth_plan WHERE id = 1"
        ).fetchone()
        nicole_mo = (plan_row['n'] if plan_row else 0) or 0
        apy_rows = conn.execute(
            "SELECT current_balance, currency, apy FROM accounts "
            "WHERE is_active = 1 AND type IN ('savings','checking') AND COALESCE(apy,0) > 0"
        ).fetchall()
        interest_mo = sum(
            ((r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD'))
            * (r['apy'] or 0) / 100.0 / 12.0
            for r in apy_rows
        )
        burn = _month_money_out(datetime.utcnow().strftime('%Y-%m')) or 0

        # Unresolved rebuke count (direct SQL — cheap)
        from datetime import timedelta
        cutoff = (datetime.utcnow() - timedelta(days=_REBUKE_MIN_DAYS)).isoformat(timespec='seconds') + 'Z'
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM rebuke_log "
            "WHERE dismissed_at IS NULL AND acted_at IS NULL "
            "AND first_flagged <= ?",
            (cutoff,),
        ).fetchone()
        n_rebukes = (row['n'] if row else 0) or 0

    # Peek staking cache for income
    staking_mo = 0.0
    for entry in (_STAKING_CACHE.values() if '_STAKING_CACHE' in globals() else []):
        if isinstance(entry, dict) and isinstance(entry.get('data'), dict):
            staking_mo += entry['data'].get('monthly_aud') or 0
    for entry in (_SOL_STAKING_CACHE.values() if '_SOL_STAKING_CACHE' in globals() else []):
        if isinstance(entry, dict) and isinstance(entry.get('data'), dict):
            staking_mo += entry['data'].get('monthly_aud') or 0

    income_mo = nicole_mo + interest_mo + staking_mo
    net_mo = income_mo - burn

    # Plan sim health + completeness — both cheap / fast functions, but plan-sim
    # calls staking fetches internally. Use cached result if available; fall
    # back to 'amber' if unknown (conservative middle).
    plan_health: Optional[str] = None
    try:
        if _PLAN_STRESS_CACHE.get('data'):
            cached_stress = _PLAN_STRESS_CACHE['data']
            base_scenario = next((s for s in (cached_stress.get('scenarios') or []) if s.get('key') == 'baseline'), None)
            if base_scenario:
                plan_health = base_scenario.get('health')
    except Exception:
        pass

    plan_completeness_status: Optional[str] = None
    try:
        completeness = api_plan_completeness()
        plan_completeness_status = completeness.get('status')
    except Exception:
        pass

    # Score each component
    surv_pts, surv_label = _score_survival(cash, burn)
    inc_pts,  inc_label  = _score_income(net_mo, burn)
    plan_pts, plan_label = _score_plan(plan_health, plan_completeness_status)
    act_pts,  act_label  = _score_action(n_rebukes)

    total = round(surv_pts + inc_pts + plan_pts + act_pts, 1)

    if total >= 85:
        verdict = 'robust'
        tone = 'green'
    elif total >= 70:
        verdict = 'solid'
        tone = 'green'
    elif total >= 55:
        verdict = 'stable but work to do'
        tone = 'amber'
    elif total >= 40:
        verdict = 'at risk'
        tone = 'amber'
    else:
        verdict = 'critical'
        tone = 'red'

    data = {
        'score': total,
        'max': 100,
        'tone': tone,
        'verdict': verdict,
        'components': [
            {'key': 'survival', 'label': 'Survival',  'points': surv_pts, 'max': 40, 'detail': surv_label},
            {'key': 'income',   'label': 'Income',    'points': inc_pts,  'max': 25, 'detail': inc_label},
            {'key': 'plan',     'label': 'Plan',      'points': plan_pts, 'max': 20, 'detail': plan_label},
            {'key': 'action',   'label': 'Action',    'points': act_pts,  'max': 15, 'detail': act_label},
        ],
        'inputs': {
            'cash_aud': round(cash, 2),
            'income_per_mo': round(income_mo, 2),
            'burn_per_mo': round(burn, 2),
            'net_per_mo': round(net_mo, 2),
            'unresolved_rebukes': n_rebukes,
            'plan_sim_health': plan_health,
            'plan_completeness': plan_completeness_status,
        },
        'as_of': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
    }
    _HEALTH_SCORE_CACHE['t'] = now
    _HEALTH_SCORE_CACHE['data'] = data
    return data


# ============================================================================
# AI Daily Telegram Brief
#
# Closes the notification loop. Composes a one-message daily summary from live
# data and sends to the configured Telegram chat. Infrastructure already in
# .env (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID).
#
# Two endpoints:
#   GET  /api/intel/telegram-brief/preview  → returns the composed text, no send
#   POST /api/intel/telegram-brief/send     → composes + fires to Telegram
#
# Composed content (Markdown, <300 chars to stay terse):
#   • Survival status (from runway) — cash, runway months, net/mo flow
#   • Top rebuke if any (from /api/intel/rebuke)
#   • Plan-sim trough if within 24 months
#   • One actionable recommendation (highest $ impact)
# ============================================================================

_TELEGRAM_BRIEF_CACHE: Dict[str, object] = {'t': 0.0, 'data': None}
_TELEGRAM_BRIEF_TTL = 1800  # 30 min — brief is daily-scale, subminute refresh is wasteful

def _compose_telegram_brief(force: bool = False) -> Dict:
    """Assemble the daily brief text + structured fields. Never raises — returns
    a partial brief with whatever data is available. Cached 30 min because this
    cascades into multiple Kimi-calling endpoints (rebuke → rate-watcher →
    forecaster), each of which can take 60+ seconds cold."""
    import time as _time
    now = _time.time()
    if not force:
        cached = _TELEGRAM_BRIEF_CACHE.get('data')
        ts = _TELEGRAM_BRIEF_CACHE.get('t') or 0
        if cached and (now - ts) < _TELEGRAM_BRIEF_TTL:
            return cached  # type: ignore[return-value]
    today = datetime.now().strftime('%a %d %b')
    lines: List[str] = [f"*WealthGuard · {today}*"]
    fields: Dict = {'date': today}

    # Survival headline — computed directly from SQL, no Kimi cascade.
    # We intentionally do NOT call api_advisor_runway here because it fetches
    # fresh staking rewards from network RPCs (ETH Etherscan + Solana public
    # RPC) which can take 30-60s cold. Brief is "glance at phone" data —
    # latency must be <2s.
    try:
        _, fx = _fx_cache()
        with get_db_connection() as conn:
            # Cash = sum of active savings+checking balances (FX'd to AUD)
            cash_rows = conn.execute(
                "SELECT current_balance, currency FROM accounts "
                "WHERE is_active = 1 AND type IN ('savings','checking')"
            ).fetchall()
            cash = sum((r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD')
                       for r in cash_rows)
            # Income: Nicole min + interest from APY rows (no staking — avoid network)
            plan_row = conn.execute(
                "SELECT COALESCE(nicole_income_monthly_min, nicole_income_monthly, 0) AS n "
                "FROM wealth_plan WHERE id = 1"
            ).fetchone()
            nicole_mo = (plan_row['n'] if plan_row else 0) or 0
            apy_rows = conn.execute(
                "SELECT current_balance, currency, apy FROM accounts "
                "WHERE is_active = 1 AND type IN ('savings','checking') AND COALESCE(apy,0) > 0"
            ).fetchall()
            interest_mo = sum(
                ((r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD'))
                * (r['apy'] or 0) / 100.0 / 12.0
                for r in apy_rows
            )
            # Living burn = last-month money_out (already filters Investment/Transfers)
            burn = _month_money_out(
                datetime.utcnow().strftime('%Y-%m')
            ) or 0

        # Staking income: peek existing caches — never trigger a fresh fetch.
        # If nothing's cached we just omit the line; the numbers stay
        # conservative rather than wait 60s for Etherscan/Solana RPC.
        staking_mo = 0.0
        for k, entry in (_STAKING_CACHE.items() if '_STAKING_CACHE' in globals() else []):
            if isinstance(entry, dict) and isinstance(entry.get('data'), dict):
                staking_mo += entry['data'].get('monthly_aud') or 0
        for k, entry in (_SOL_STAKING_CACHE.items() if '_SOL_STAKING_CACHE' in globals() else []):
            if isinstance(entry, dict) and isinstance(entry.get('data'), dict):
                staking_mo += entry['data'].get('monthly_aud') or 0

        income_mo = nicole_mo + interest_mo + staking_mo
        fields['staking_per_mo'] = round(staking_mo, 0)
        net = income_mo - burn
        months = (cash / burn) if burn > 0 and income_mo < burn else None
        fields['cash_aud'] = round(cash, 0)
        fields['income_per_mo'] = round(income_mo, 0)
        fields['burn_per_mo'] = round(burn, 0)
        fields['net_per_mo'] = round(net, 0)
        fields['runway_months'] = months
        sign = '+' if net >= 0 else ''
        if months is None:
            lines.append(f"Cash `${cash:,.0f}` · net `{sign}${net:,.0f}/mo` · surplus")
        else:
            lines.append(f"Cash `${cash:,.0f}` · net `{sign}${net:,.0f}/mo` · runway `{months:.0f}mo`")
    except Exception as e:
        logger.warning(f"telegram-brief: survival compose failed: {e}")
        lines.append("_survival data unavailable_")

    # Rebuke count (lightweight — just count unresolved items from the
    # rebuke_log table, don't fire Kimi).  If we want the rebuke text we can
    # add a daily cron that warms the full /api/intel/rebuke cache first.
    try:
        with get_db_connection() as conn:
            from datetime import timedelta
            cutoff = (datetime.utcnow() - timedelta(days=_REBUKE_MIN_DAYS)).isoformat(timespec='seconds') + 'Z'
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM rebuke_log "
                "WHERE dismissed_at IS NULL AND acted_at IS NULL "
                "AND first_flagged <= ?",
                (cutoff,),
            ).fetchone()
        n_rebukes = (row['n'] if row else 0) or 0
        if n_rebukes > 0:
            fields['rebuke_count'] = n_rebukes
            lines.append(f"⚠ `{n_rebukes}` unresolved advisor item{'s' if n_rebukes != 1 else ''} (>7d)")
    except Exception as e:
        logger.warning(f"telegram-brief: rebuke count failed: {e}")

    # Plan trough: skipped in the brief compose because api_plan_simulate() calls
    # fresh staking fetches that can add 30-60s latency. The Dashboard Plan
    # Tracker already surfaces this every visit; the brief doesn't need to
    # duplicate. If we want it later, a separate cron can warm the plan-sim
    # cache before the brief fires.

    # Top recommendation by $ impact
    try:
        from advisor_engine import build_recommendations
        _, fx = _fx_cache()
        nw = _net_worth_breakdown_aud()
        with get_db_connection() as conn:
            recs_payload = build_recommendations(conn, fx, nw['net_worth_aud'])
        recs = [r for r in (recs_payload.get('recommendations') or [])
                if (r.get('est_impact_aud_per_year') or 0) > 0]
        recs.sort(key=lambda r: -(r.get('est_impact_aud_per_year') or 0))
        if recs:
            top_rec = recs[0]
            fields['top_rec'] = {
                'kind': top_rec.get('kind'),
                'title': top_rec.get('title'),
                'impact_yr': top_rec.get('est_impact_aud_per_year'),
            }
            lines.append(
                f"💡 `${top_rec.get('est_impact_aud_per_year'):,.0f}/yr` · {top_rec.get('title')}"
            )
    except Exception as e:
        logger.warning(f"telegram-brief: recs fetch failed: {e}")

    text = '\n'.join(lines)
    # Trim to safe Telegram message length (4096 chars, but we want <300 for glanceability)
    if len(text) > 600:
        text = text[:597] + '...'

    result = {
        'text': text,
        'fields': fields,
        'as_of': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
    }
    _TELEGRAM_BRIEF_CACHE['t'] = now
    _TELEGRAM_BRIEF_CACHE['data'] = result
    return result


@app.get("/api/intel/telegram-brief/preview")
def api_telegram_brief_preview(force: bool = False):
    """Return the composed daily brief without sending. Useful for the UI
    'Preview' button and for sanity-checking content before enabling auto-send.
    `force=true` rebuilds from scratch (skips the 30min cache)."""
    return _compose_telegram_brief(force=force)


@app.post("/api/intel/telegram-brief/send")
def api_telegram_brief_send():
    """Compose + deliver the daily brief to the configured Telegram chat.
    Returns structured result so the UI can show delivery status."""
    import urllib.request, urllib.parse, ssl as _ssl, json as _json
    token = os.getenv('TELEGRAM_BOT_TOKEN', '').strip()
    chat_id = os.getenv('TELEGRAM_CHAT_ID', '').strip()
    if not token or not chat_id:
        raise HTTPException(
            status_code=400,
            detail="Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env."
        )

    brief = _compose_telegram_brief()
    try:
        import certifi
        ctx = _ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = _ssl.create_default_context()

    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = _json.dumps({
            'chat_id': chat_id,
            'text': brief['text'],
            'parse_mode': 'Markdown',
            'disable_web_page_preview': True,
        }).encode()
        req = urllib.request.Request(
            url, data=payload,
            headers={'Content-Type': 'application/json', 'User-Agent': 'WealthGuard/1.0'},
        )
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            tg = _json.loads(resp.read().decode())
        if not tg.get('ok'):
            return {
                'delivered': False,
                'error': tg.get('description', 'telegram rejected the message'),
                'brief': brief,
            }
        return {
            'delivered': True,
            'message_id': (tg.get('result') or {}).get('message_id'),
            'brief': brief,
        }
    except urllib.error.HTTPError as he:
        body = he.read().decode() if hasattr(he, 'read') else ''
        logger.warning(f"telegram send HTTPError {he.code}: {body}")
        return {'delivered': False, 'error': f'HTTP {he.code}: {body[:200]}', 'brief': brief}
    except Exception as e:
        logger.exception(f"telegram send failed: {e}")
        return {'delivered': False, 'error': str(e), 'brief': brief}


# ============================================================================
# AI Spending Forecast
#
# Proactive intel: projects the next 6 months of living spend per category
# using simple OLS on the last 6 months of the category-trend endpoint.
# Flags categories with accelerating burn and returns a Kimi narrative that
# names the fastest-growing category and the single thing worth investigating.
#
# Cached 1h — category trends update monthly, hourly re-compute is enough.
# ============================================================================
_SPENDING_FORECAST_CACHE: Dict[str, object] = {'t': 0.0, 'data': None}
_SPENDING_FORECAST_TTL = 3600  # 1h
_FORECAST_WINDOW_MONTHS = 6    # months of history used for the regression
_FORECAST_HORIZON_MONTHS = 6   # months projected forward
# Categories excluded from the LIVING-BURN forecast. These are asset moves,
# not consumption — treating them as "accelerating burn" is misleading:
# the money hasn't left the balance sheet, it's just re-allocated.
_FORECAST_EXCLUDE_CATEGORIES = {'Investment', 'Transfers', 'Invoice'}

def _linreg_slope_intercept(xs: List[float], ys: List[float]) -> Tuple[float, float]:
    """Plain ordinary-least-squares for 1D regression. Returns (slope, intercept).
    Used on monthly spend series — tiny dataset, no numpy needed."""
    n = len(xs)
    if n < 2:
        return 0.0, (ys[0] if ys else 0.0)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    num = sum((xs[i] - mean_x) * (ys[i] - mean_y) for i in range(n))
    den = sum((xs[i] - mean_x) ** 2 for i in range(n))
    if den == 0:
        return 0.0, mean_y
    slope = num / den
    intercept = mean_y - slope * mean_x
    return slope, intercept


@app.get("/api/intel/spending-forecast")
def api_spending_forecast(force: bool = False, cache_only: bool = False):
    """Per-category 6-month spend projection + Kimi narrative on the fastest-
    growing category. Pulls /api/expenses/category-trend as raw history.

    `cache_only=True` → see `_with_cache_meta` docstring (Iteration 22)."""
    import time as _time
    now = _time.time()
    cached = _SPENDING_FORECAST_CACHE.get('data')
    ts = _SPENDING_FORECAST_CACHE.get('t') or 0
    if not force:
        if cached and (now - ts) < _SPENDING_FORECAST_TTL:
            return _with_cache_meta(cached, ts, now)
        if cache_only:
            if cached:
                return _with_cache_meta(cached, ts, now, stale=True)
            return {'cached': False}

    try:
        # Pull trend directly via internal function call (not HTTP)
        trend = api_expenses_category_trend(months=12)
        months: List[str] = trend.get('months') or []
        categories: List[str] = trend.get('categories') or []
        series: List[Dict] = trend.get('series') or []

        if len(months) < _FORECAST_WINDOW_MONTHS or not categories:
            return {'error': 'not enough history for a forecast', 'months_available': len(months)}

        # Use the LAST N months as the regression window
        window_start = len(months) - _FORECAST_WINDOW_MONTHS
        xs = list(range(_FORECAST_WINDOW_MONTHS))  # 0..N-1
        forecasts: List[Dict] = []

        for cat in categories:
            # Exclude asset-allocation buckets — those aren't living burn,
            # they're money moved between the user's own accounts/positions.
            if cat in _FORECAST_EXCLUDE_CATEGORIES:
                continue
            ys = [float(series[window_start + i].get(cat, 0) or 0) for i in range(_FORECAST_WINDOW_MONTHS)]
            # Skip categories with zero movement in the window (noise)
            if max(ys) < 20:
                continue
            slope, intercept = _linreg_slope_intercept([float(x) for x in xs], ys)
            window_avg = sum(ys) / len(ys)
            last_month_spend = ys[-1]

            # Project horizon months forward: x = window_len, window_len+1, ...
            # Floor each month at 30% of the window average so a steep recent-
            # decline slope doesn't extrapolate a category to near-zero
            # (happens when users cut back temporarily, then normalise).
            floor = window_avg * 0.30
            projected_monthly: List[float] = []
            for h in range(_FORECAST_HORIZON_MONTHS):
                x_proj = _FORECAST_WINDOW_MONTHS + h
                y_proj = max(floor, slope * x_proj + intercept)
                projected_monthly.append(round(y_proj, 2))
            projected_total_6mo = round(sum(projected_monthly), 2)

            # Trend tagging — % change between projected next month and window avg
            next_month_proj = projected_monthly[0] if projected_monthly else window_avg
            pct_change = ((next_month_proj - window_avg) / window_avg * 100) if window_avg > 0 else 0
            if abs(pct_change) < 8:
                direction = 'stable'
            elif pct_change > 0:
                direction = 'accelerating'
            else:
                direction = 'easing'

            forecasts.append({
                'category': cat,
                'window_avg_monthly_aud': round(window_avg, 2),
                'last_month_aud': round(last_month_spend, 2),
                'slope_aud_per_month': round(slope, 2),
                'projected_next_month_aud': round(next_month_proj, 2),
                'projected_6mo_total_aud': projected_total_6mo,
                'monthly_series_next_6': projected_monthly,
                'pct_change_vs_window_avg': round(pct_change, 1),
                'direction': direction,
            })

        # Rank by projected 6mo spend (biggest = most material)
        forecasts.sort(key=lambda f: f['projected_6mo_total_aud'], reverse=True)

        total_projected_6mo = round(sum(f['projected_6mo_total_aud'] for f in forecasts), 2)
        total_window_monthly = round(sum(f['window_avg_monthly_aud'] for f in forecasts), 2)
        total_projected_monthly = round(sum(f['projected_next_month_aud'] for f in forecasts), 2)
        accelerating = [f for f in forecasts if f['direction'] == 'accelerating']
        easing = [f for f in forecasts if f['direction'] == 'easing']
        fastest_grower = max(forecasts, key=lambda f: f['slope_aud_per_month'], default=None) if accelerating else None

        # Kimi narrative — only fire if there's a material accelerator.
        narrative: Optional[str] = None
        provider: Optional[str] = None
        material_accel = fastest_grower and fastest_grower['slope_aud_per_month'] > 25
        if material_accel:
            try:
                top_lines = '\n'.join(
                    f"  · {f['category']:<24} avg last 6mo ${f['window_avg_monthly_aud']:,.0f}/mo  "
                    f"next-month proj ${f['projected_next_month_aud']:,.0f}  "
                    f"slope ${f['slope_aud_per_month']:+,.0f}/mo  ({f['direction']})"
                    for f in forecasts[:8]
                )
                system = (
                    "You are the AI financial advisor for Christopher & Nicole Howell. They are in drawdown "
                    "mode heading to 2030 retirement; every $100/mo in controllable spend is $1,200/yr off the "
                    "retirement target. Your job right now: in ONE paragraph (max 110 words), name the single "
                    "fastest-growing spending category, quantify the monthly slope, project the 6-month "
                    "cumulative cost, and suggest ONE specific investigation step. Be direct. No lecturing. "
                    "No 'should'. Numbers every sentence."
                )
                user = (
                    f"SPENDING CATEGORY FORECAST (6-month regression, projected 6mo forward):\n{top_lines}\n\n"
                    f"Total next-month projected living spend: ${total_projected_monthly:,.0f}/mo "
                    f"(vs 6-mo avg ${total_window_monthly:,.0f}/mo).\n"
                    f"Total 6-month projected spend: ${total_projected_6mo:,.0f}.\n"
                    f"Fastest grower: {fastest_grower['category']} at "
                    f"${fastest_grower['slope_aud_per_month']:+,.0f}/month slope.\n\n"
                    "Give ONE paragraph per the system instructions."
                )
                narrative = _kimi_chat(system, user, max_tokens=4000, temperature=1)
                provider = 'kimi' if narrative else None
            except Exception as e:
                logger.warning(f"spending-forecast Kimi call failed: {e}")

        if not narrative:
            if fastest_grower:
                narrative = (
                    f"{fastest_grower['category']} slope ${fastest_grower['slope_aud_per_month']:+,.0f}/mo — "
                    f"projected 6-month cumulative ${fastest_grower['projected_6mo_total_aud']:,.0f} "
                    f"vs recent average ${fastest_grower['window_avg_monthly_aud']:,.0f}/mo. "
                    f"Review transactions in this category last 30 days to confirm the accelerator is real, "
                    f"not a reclassification."
                )
                provider = 'fallback'
            else:
                narrative = "All categories trending flat or easing. No accelerator to investigate."
                provider = 'fallback'

        data = {
            'as_of': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
            'window_months': _FORECAST_WINDOW_MONTHS,
            'horizon_months': _FORECAST_HORIZON_MONTHS,
            'categories': forecasts,
            'total_window_monthly_aud': total_window_monthly,
            'total_projected_monthly_aud': total_projected_monthly,
            'total_projected_6mo_aud': total_projected_6mo,
            'accelerating_count': len(accelerating),
            'easing_count': len(easing),
            'fastest_grower': fastest_grower,
            'narrative': narrative,
            'narrative_provider': provider,
        }
        _SPENDING_FORECAST_CACHE['t'] = now
        _SPENDING_FORECAST_CACHE['data'] = data
        return data
    except Exception as e:
        logger.exception(f"spending-forecast failed: {e}")
        return {'error': str(e), 'as_of': datetime.utcnow().isoformat() + 'Z'}


# ============================================================================
# AI Validator Performance Monitor
#
# Defensive intel: protects the ~$594/mo staking income stream. Pulls both
# existing staking endpoints (which now report `implied_apy_pct`, `network_apy_pct`,
# `apy_gap_pct`, `gap_annual_aud`, `validator_status`) and rolls them into one
# consolidated view. When a material gap exists (|gap_pct| > 50 bps on any
# chain), invokes Kimi for a single-paragraph action recommendation.
#
# Cached 15min. The underlying staking endpoints already cache 1h so the inner
# network-fetch cost is already amortised.
# ============================================================================
_VALIDATOR_MONITOR_CACHE: Dict[str, object] = {'t': 0.0, 'data': None}
_VALIDATOR_MONITOR_TTL = 900  # 15 min
_VALIDATOR_MATERIAL_GAP_BPS = 50  # 0.50% = threshold for Kimi narrative

@app.get("/api/intel/validator-monitor")
def api_validator_monitor(force: bool = False, cache_only: bool = False):
    """Consolidated validator-performance intel for ETH + SOL. Flags under-
    performance vs network mean, quantifies the $/yr gap, and produces a
    Kimi action recommendation when the gap is material.

    `cache_only=True` → see `_with_cache_meta` docstring (Iteration 22)."""
    import time as _time
    now = _time.time()
    cached = _VALIDATOR_MONITOR_CACHE.get('data')
    ts = _VALIDATOR_MONITOR_CACHE.get('t') or 0
    if not force:
        if cached and (now - ts) < _VALIDATOR_MONITOR_TTL:
            return _with_cache_meta(cached, ts, now)
        if cache_only:
            if cached:
                return _with_cache_meta(cached, ts, now, stale=True)
            return {'cached': False}

    chains: List[Dict] = []
    total_gap_annual_aud = 0.0
    worst_gap_chain: Optional[Dict] = None

    try:
        # ETH — default address from env
        eth_addr = os.getenv('CRYPTO_STAKING_ADDRESSES', '0x456099f8DE31c594CA40c8D868237e75ECc03d1e').split(',')[0].strip()
        eth = _fetch_eth_staking(eth_addr)
        if (eth.get('eth_staked') or 0) > 0:
            chain = {
                'chain': 'ETH',
                'address': eth.get('address'),
                'amount_staked': eth.get('eth_staked'),
                'amount_staked_unit': 'ETH',
                'staked_value_aud': eth.get('staked_value_aud', 0),
                'implied_apy_pct': eth.get('implied_apy_pct', 0),
                'network_apy_pct': eth.get('network_apy_pct', ETH_NETWORK_APY_REF),
                'apy_gap_pct': eth.get('apy_gap_pct', 0),
                'gap_annual_aud': eth.get('gap_annual_aud', 0),
                'status': eth.get('validator_status', 'unknown'),
                'monthly_aud': eth.get('monthly_aud', 0),
            }
            chains.append(chain)
            total_gap_annual_aud += chain['gap_annual_aud']

        # SOL — from env
        sol_addr = (os.getenv('SOLANA_STAKING_WALLET') or '').split(',')[0].strip()
        if sol_addr:
            sol = _fetch_solana_staking(sol_addr)
            if (sol.get('delegated_sol') or 0) > 0:
                chain = {
                    'chain': 'SOL',
                    'address': sol.get('address'),
                    'voter': sol.get('voter'),
                    'amount_staked': sol.get('delegated_sol'),
                    'amount_staked_unit': 'SOL',
                    'staked_value_aud': sol.get('staked_value_aud', sol.get('delegated_aud', 0)),
                    'implied_apy_pct': sol.get('implied_apy_pct', 0),
                    'network_apy_pct': sol.get('network_apy_pct', SOL_NETWORK_APY_REF),
                    'apy_gap_pct': sol.get('apy_gap_pct', 0),
                    'gap_annual_aud': sol.get('gap_annual_aud', 0),
                    'status': sol.get('validator_status', 'unknown'),
                    'monthly_aud': sol.get('monthly_aud', 0),
                }
                chains.append(chain)
                total_gap_annual_aud += chain['gap_annual_aud']

        # Worst-gap chain (most negative = biggest underperformer)
        underperf = [c for c in chains if c['apy_gap_pct'] < 0]
        if underperf:
            worst_gap_chain = min(underperf, key=lambda c: c['apy_gap_pct'])

        # Kimi narrative — only fire if there's a material gap (avoid LLM cost
        # on a clean report) and frame as the advisor voice we established.
        narrative: Optional[str] = None
        provider: Optional[str] = None
        material_gap = any(abs(c['apy_gap_pct']) >= (_VALIDATOR_MATERIAL_GAP_BPS / 100.0) for c in chains)

        if material_gap:
            try:
                lines = '\n'.join(
                    f"  · {c['chain']}: {c['amount_staked']:,.2f} {c['amount_staked_unit']} "
                    f"@ {c['implied_apy_pct']:.2f}% vs network mean {c['network_apy_pct']:.2f}% "
                    f"(gap {c['apy_gap_pct']:+.2f}%, {c['gap_annual_aud']:+,.0f}/yr)  "
                    f"status={c['status']}"
                    for c in chains
                )
                system = (
                    "You are the AI financial advisor for Christopher & Nicole Howell. "
                    "They have crypto staked for passive income — ETH via beacon validators, "
                    "SOL via a delegated stake account. Your job right now: tell them in one "
                    "paragraph (max 110 words) which chain is underperforming most, the $/yr "
                    "gap, and the specific action to close it. Direct, no lecturing. Numbers "
                    "every sentence. Switching a SOL stake delegation costs one transaction "
                    "(~30c fee) and takes one epoch (~2.5 days) to activate. Switching an ETH "
                    "validator is more involved (exit + withdraw + re-stake = ~1-2 weeks + gas)."
                )
                user = (
                    f"VALIDATOR PERFORMANCE SNAPSHOT:\n{lines}\n\n"
                    f"Total annual gap across both chains: ${total_gap_annual_aud:,.0f}/yr.\n\n"
                    "Give ONE paragraph. Name the worst chain, quantify the $/yr cost, state "
                    "the specific switch action. If a chain is on-par or outperforming, say "
                    "so in one sentence at the end — don't fabricate concern."
                )
                narrative = _kimi_chat(system, user, max_tokens=4000, temperature=1)
                provider = 'kimi' if narrative else None
            except Exception as e:
                logger.warning(f"validator-monitor Kimi call failed: {e}")

        if not narrative:
            if worst_gap_chain and worst_gap_chain['apy_gap_pct'] <= -0.5:
                narrative = (
                    f"{worst_gap_chain['chain']} validator paying {worst_gap_chain['implied_apy_pct']:.2f}% vs "
                    f"network mean {worst_gap_chain['network_apy_pct']:.2f}% — "
                    f"${abs(worst_gap_chain['gap_annual_aud']):,.0f}/yr left on the table. "
                    f"{'Switch delegation (~30c fee, one epoch to activate).' if worst_gap_chain['chain'] == 'SOL' else 'Plan a validator rotation at the next natural exit opportunity.'}"
                )
                provider = 'fallback'
            else:
                narrative = "Validators on-par with network averages — no action needed."
                provider = 'fallback'

        data = {
            'as_of': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
            'chains': chains,
            'total_gap_annual_aud': round(total_gap_annual_aud, 2),
            'worst_gap_chain': worst_gap_chain,
            'material_gap': material_gap,
            'narrative': narrative,
            'narrative_provider': provider,
        }
        _VALIDATOR_MONITOR_CACHE['t'] = now
        _VALIDATOR_MONITOR_CACHE['data'] = data
        return data
    except Exception as e:
        logger.exception(f"validator-monitor failed: {e}")
        return {'error': str(e), 'as_of': datetime.utcnow().isoformat() + 'Z'}


_advisor_narrative_cache: Dict[str, Dict] = {}


@app.get("/api/harness/runs")
def api_harness_runs(agent: Optional[str] = None, limit: int = 100):
    """Recent agent runs from the harness. Supports filter by agent name."""
    limit = max(1, min(limit, 500))
    with get_db_connection() as conn:
        if agent:
            rows = conn.execute(
                "SELECT id, agent_name, severity, status, duration_seconds, "
                "substr(output, 1, 4000) AS output_excerpt, started_at, completed_at "
                "FROM agent_runs WHERE agent_name = ? ORDER BY started_at DESC LIMIT ?",
                (agent, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, agent_name, severity, status, duration_seconds, "
                "substr(output, 1, 4000) AS output_excerpt, started_at, completed_at "
                "FROM agent_runs ORDER BY started_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/harness/runs/{run_id}")
def api_harness_run_detail(run_id: int):
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM agent_runs WHERE id = ?", (run_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Run not found")
    return dict(row)


@app.get("/api/harness/agents")
def api_harness_agents():
    """List of registered agents with last-run summary."""
    import os as _os
    import re as _re
    agents_dir = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), '.claude', 'agents')
    if not _os.path.isdir(agents_dir):
        return []
    agents = []
    for fn in sorted(_os.listdir(agents_dir)):
        if not fn.endswith('.md'):
            continue
        name = fn[:-3]
        path = _os.path.join(agents_dir, fn)
        try:
            with open(path) as f:
                body = f.read()
            # Parse front-matter
            fm_match = _re.match(r'^---\n(.*?)\n---', body, _re.DOTALL)
            meta = {}
            if fm_match:
                for line in fm_match.group(1).splitlines():
                    if ':' in line:
                        k, v = line.split(':', 1)
                        meta[k.strip()] = v.strip()
        except Exception:
            meta = {}
        agents.append({
            'name': name,
            'description': meta.get('description', ''),
            'model': meta.get('model', 'sonnet'),
        })
    # Attach last-run info per agent
    with get_db_connection() as conn:
        for a in agents:
            r = conn.execute(
                "SELECT id, severity, status, started_at FROM agent_runs "
                "WHERE agent_name = ? ORDER BY started_at DESC LIMIT 1",
                (a['name'],),
            ).fetchone()
            a['last_run'] = dict(r) if r else None
    return agents


@app.post("/api/harness/trigger/{agent_name}")
def api_harness_trigger(agent_name: str):
    """Manually kick off an agent run via the harness. Non-blocking (backgrounds)."""
    import subprocess as _sp
    import shlex as _shlex
    harness = '/Users/christopherhowell/WealthGuard/harness/wealth_harness.py'
    venv_py = '/Users/christopherhowell/WealthGuard/wealthguard_source/.venv/bin/python'
    try:
        _sp.Popen([venv_py, harness, '--agent', agent_name],
                  cwd='/Users/christopherhowell/WealthGuard',
                  stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
        return {'triggered': agent_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/search")
def api_search(q: str = "", limit_per: int = 10):
    """Global search across pages, holdings, accounts, goals, transactions,
    categories, merchants, and PodBits episodes. Case-insensitive substring
    match. Returns grouped results + counts so the UI can show a proper palette."""
    q = (q or '').strip()
    out = {
        'query': q,
        'holdings': [],
        'accounts': [],
        'goals': [],
        'transactions': [],
        'categories': [],
        'merchants': [],
        'episodes': [],
        'counts': {},
    }
    if len(q) < 2:
        return out
    limit_per = max(1, min(limit_per, 50))
    like = f"%{q}%"

    with get_db_connection() as conn:
        # Holdings (symbol + asset_name)
        rows = conn.execute(
            """SELECT id, symbol, asset_name, asset_class
               FROM holdings WHERE shares > 0 AND
                 (LOWER(symbol) LIKE LOWER(?) OR LOWER(COALESCE(asset_name,'')) LIKE LOWER(?))
               ORDER BY symbol LIMIT ?""",
            (like, like, limit_per),
        ).fetchall()
        out['holdings'] = [dict(r) for r in rows]

        # Accounts (name + institution)
        rows = conn.execute(
            """SELECT id, name, type, currency, institution, current_balance
               FROM accounts
               WHERE is_active = 1 AND
                 (LOWER(name) LIKE LOWER(?) OR LOWER(COALESCE(institution,'')) LIKE LOWER(?))
               ORDER BY name LIMIT ?""",
            (like, like, limit_per),
        ).fetchall()
        out['accounts'] = [dict(r) for r in rows]

        # Goals
        rows = conn.execute(
            """SELECT id, name, target_amount, target_date
               FROM goals
               WHERE LOWER(name) LIKE LOWER(?) OR LOWER(COALESCE(notes,'')) LIKE LOWER(?)
               ORDER BY target_date LIMIT ?""",
            (like, like, limit_per),
        ).fetchall()
        out['goals'] = [dict(r) for r in rows]

        # Transactions — search all rows by payee or description, return most recent.
        total_txn_row = conn.execute(
            """SELECT COUNT(*) AS n FROM transactions
               WHERE LOWER(COALESCE(payee,'')) LIKE LOWER(?)
                  OR LOWER(COALESCE(description,'')) LIKE LOWER(?)""",
            (like, like),
        ).fetchone()
        total_txn = total_txn_row['n'] if total_txn_row else 0
        rows = conn.execute(
            """SELECT t.id, t.transaction_date, t.payee, t.amount, t.category, t.currency,
                      a.name AS account_name
               FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
               WHERE LOWER(COALESCE(t.payee,'')) LIKE LOWER(?)
                  OR LOWER(COALESCE(t.description,'')) LIKE LOWER(?)
               ORDER BY t.transaction_date DESC, t.id DESC
               LIMIT ?""",
            (like, like, limit_per),
        ).fetchall()
        out['transactions'] = [dict(r) for r in rows]
        out['counts']['transactions_total'] = total_txn

        # Categories — distinct values from transactions.
        rows = conn.execute(
            """SELECT t.category AS name, COUNT(*) AS n,
                      -SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS spend
               FROM transactions t
               WHERE t.category IS NOT NULL AND LOWER(t.category) LIKE LOWER(?)
                 AND t.transaction_type != 'transfer'
               GROUP BY t.category ORDER BY spend DESC LIMIT ?""",
            (like, limit_per),
        ).fetchall()
        out['categories'] = [dict(r) for r in rows]

        # Merchants — aggregated payees.
        rows = conn.execute(
            """SELECT t.payee AS name, COUNT(*) AS n,
                      -SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS spend,
                      MAX(t.transaction_date) AS last_seen
               FROM transactions t
               WHERE t.payee IS NOT NULL AND LOWER(t.payee) LIKE LOWER(?)
                 AND t.transaction_type != 'transfer'
               GROUP BY t.payee ORDER BY spend DESC LIMIT ?""",
            (like, limit_per),
        ).fetchall()
        out['merchants'] = [dict(r) for r in rows]

        # PodBits episodes — reuse the existing search helper if available.
        try:
            eps = conn.execute(
                """SELECT e.id AS episode_id, e.title, s.name AS source_name
                   FROM podbits_episodes e LEFT JOIN podbits_sources s ON s.id = e.source_id
                   WHERE LOWER(e.title) LIKE LOWER(?) OR LOWER(COALESCE(e.summary,'')) LIKE LOWER(?)
                   ORDER BY e.published_at DESC LIMIT ?""",
                (like, like, limit_per),
            ).fetchall()
            out['episodes'] = [dict(r) for r in eps]
        except Exception:
            out['episodes'] = []

    out['counts'].update({
        'holdings': len(out['holdings']),
        'accounts': len(out['accounts']),
        'goals': len(out['goals']),
        'transactions': len(out['transactions']),
        'categories': len(out['categories']),
        'merchants': len(out['merchants']),
        'episodes': len(out['episodes']),
    })
    return out


@app.get("/api/advisor/recommendations")
def api_advisor_recommendations():
    """Holistic wealth recommendations across cash, expenses, investments, tax,
    debt, goals, and net-worth dimensions. Deterministic rules; cheap & instant."""
    from advisor_engine import build_recommendations
    _, fx = _fx_cache()
    nw = _net_worth_breakdown_aud()
    with get_db_connection() as conn:
        return build_recommendations(conn, fx, nw['net_worth_aud'])


@app.get("/api/vision/projection")
def api_vision_projection(years: int = 30):
    """Compound the user's current asset-class mix over `years` using configurable
    growth rates (sent as query params for scenario analysis, or defaulted).

    Query params (all optional, pa %):
      rate_real_estate=5  rate_cash=4  rate_crypto=15
      rate_equity=8       rate_vehicles=-10   rate_bonds=4
    """
    from fastapi import Request
    years = max(1, min(years, 40))
    _, fx = _fx_cache()

    # Current composition by asset class (AUD).
    buckets = {
        'Real Estate': 0.0,
        'Cash': 0.0,
        'Crypto': 0.0,
        'Equities': 0.0,
        'Vehicles': 0.0,
    }
    with get_db_connection() as conn:
        # Holdings → class buckets
        rows = conn.execute(
            """SELECT h.symbol, h.asset_name, h.asset_class, h.shares, h.current_price,
                      COALESCE(h.native_currency,'USD') AS ccy
               FROM holdings h WHERE h.shares > 0"""
        ).fetchall()
        for r in rows:
            val = (r['shares'] or 0) * (r['current_price'] or 0) * fx(r['ccy'].upper(), 'AUD')
            cls = (r['asset_class'] or '').lower()
            sym = (r['symbol'] or '')
            if cls == 'crypto':
                buckets['Crypto'] += val
            elif cls in ('equity', 'etf'):
                buckets['Equities'] += val
            elif sym.startswith('REAL_ESTATE_'):
                buckets['Real Estate'] += val
            elif sym.startswith('VEHICLE_'):
                buckets['Vehicles'] += val
            else:
                buckets['Real Estate'] += val  # default alternative → RE
        # Cash from accounts
        cash_rows = conn.execute(
            "SELECT current_balance, currency FROM accounts "
            "WHERE is_active=1 AND type IN ('savings','checking')"
        ).fetchall()
        for r in cash_rows:
            buckets['Cash'] += (r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD')

    # Default real-world growth assumptions (pa, nominal AUD).
    rates = {
        'Real Estate': 5.0,
        'Cash':        4.0,
        'Crypto':     15.0,  # optimistic — matches user's BTC thesis
        'Equities':    8.0,
        'Vehicles':  -10.0,  # depreciate
    }

    # Build series: year 0, 5, 10, 15, 20, 25, 30 (or whatever user asked for).
    snapshots = sorted({0, 5, 10, 15, 20, 25, 30, years})
    snapshots = [s for s in snapshots if s <= years]
    if years not in snapshots:
        snapshots.append(years)

    series = []
    for y in snapshots:
        snap = {'year': y, 'total': 0.0, 'buckets': {}}
        for name, v in buckets.items():
            rate = rates[name] / 100
            projected = v * ((1 + rate) ** y)
            snap['buckets'][name] = round(projected, 0)
            snap['total'] += projected
        snap['total'] = round(snap['total'], 0)
        series.append(snap)

    return {
        'current': {name: round(v, 0) for name, v in buckets.items()},
        'rates': rates,
        'series': series,
        'milestones': [
            {'name': 'Current', 'amount': round(sum(buckets.values()), 0)},
            {'name': 'Lean FI ($3M)', 'amount': 3_000_000},
            {'name': 'Comfortable FI ($5M)', 'amount': 5_000_000},
            {'name': 'FatFI ($10M)', 'amount': 10_000_000},
        ],
    }


class WealthPlanIn(BaseModel):
    # Acacia
    acacia_current_value: Optional[float] = None
    acacia_reno_remaining: Optional[float] = None
    acacia_target_sale_price: Optional[float] = None
    acacia_target_sale_month: Optional[str] = None
    acacia_is_ppor: Optional[int] = None
    # Lind
    lind_current_value: Optional[float] = None
    lind_mortgage_balance: Optional[float] = None
    lind_build_cost: Optional[float] = None
    lind_build_start_month: Optional[str] = None
    lind_build_end_month: Optional[str] = None
    lind_target_sale_price: Optional[float] = None
    lind_target_sale_month: Optional[str] = None
    lind_is_ppor: Optional[int] = None
    # Retirement
    retirement_start_month: Optional[str] = None
    retirement_property: Optional[str] = None
    retirement_prep_cost: Optional[float] = None
    retirement_monthly_spend: Optional[float] = None
    retirement_income_monthly: Optional[float] = None
    notes: Optional[str] = None


@app.get("/api/plan")
def api_plan_get():
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM wealth_plan WHERE id = 1").fetchone()
    return dict(row) if row else {}


# ============================================================================
# Plan Completeness Gate
#
# Recurring issue: `wealth_plan` ships with several null timing/amount fields.
# The simulator can't produce a realistic cash trajectory without them — the
# known "-$77k in 2028-11 trough" is a direct consequence of missing dates.
# This endpoint returns a structured list of gap fields so the Plan page can
# surface a completeness banner with per-field severity, current value, and
# impact note.
# ============================================================================

# Ordered gaps to check; tuple: (field, human-label, severity, impact note)
_PLAN_GAP_SPECS: List[Tuple[str, str, str, str]] = [
    ('acacia_target_sale_month',   'Acacia sale month',          'high',   'Without this, the sim never books the $450k proceeds and trough goes negative.'),
    ('lind_build_start_month',     'Lind build start month',     'high',   'Sim spreads the $700k build generically — wrong months get debited.'),
    ('lind_build_end_month',       'Lind build end month',       'high',   'Pairs with build start to time the spend envelope.'),
    ('retirement_start_month',     'Retirement start month',     'high',   'Post-retirement living-spend switch-over anchor.'),
    ('retirement_monthly_spend',   'Retirement monthly spend',   'medium', 'Defaults to current burn — usually optimistic for retirees.'),
    ('retirement_income_monthly',  'Retirement monthly income',  'medium', 'Models super/pension draw. Zero = most conservative.'),
    ('retirement_prep_cost',       'Retirement prep cost',       'low',    'One-off Ansons Bay preparation (fit-out, furniture, etc.).'),
    ('retirement_property',        'Retirement property',        'low',    'Free-text anchor for the target retirement address.'),
    ('lind_current_value',         'Lind current value',         'low',    'Needed for equity-released-on-sale math if you want accuracy.'),
]


@app.get("/api/plan/completeness")
def api_plan_completeness():
    """List of plan fields whose null-ness distorts the simulator. Each gap
    carries severity + a human-readable label + impact note so the UI can
    render a focused completeness banner."""
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM wealth_plan WHERE id = 1").fetchone()
    plan = dict(row) if row else {}

    gaps: List[Dict] = []
    filled: List[Dict] = []
    sev_counts = {'high': 0, 'medium': 0, 'low': 0}
    for field, label, sev, impact in _PLAN_GAP_SPECS:
        val = plan.get(field)
        is_null = val is None or (isinstance(val, str) and not val.strip())
        # Special-case: lind_target_sale_month is acceptable as '2028' but the
        # sim coerces it to 2028-12. Flag 'lind_target_sale_month' as a soft
        # warning when it's year-only, but don't add to the main gap list —
        # the date-only input is deliberate user choice for this field.
        record = {
            'field': field,
            'label': label,
            'severity': sev,
            'impact': impact,
            'current_value': val if not is_null else None,
        }
        if is_null:
            gaps.append(record)
            sev_counts[sev] = sev_counts.get(sev, 0) + 1
        else:
            filled.append(record)

    complete = len(gaps) == 0
    high_open = sev_counts['high']
    status = 'green' if complete else ('red' if high_open > 0 else 'amber')

    return {
        'status': status,
        'complete': complete,
        'gaps': gaps,
        'filled': filled,
        'counts': {
            'high_open': sev_counts['high'],
            'medium_open': sev_counts['medium'],
            'low_open': sev_counts['low'],
            'total_open': len(gaps),
            'total_checked': len(_PLAN_GAP_SPECS),
        },
        'as_of': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
    }


@app.put("/api/plan")
def api_plan_put(payload: WealthPlanIn):
    fields = {k: v for k, v in payload.dict().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_db_connection() as conn:
        conn.execute("INSERT OR IGNORE INTO wealth_plan (id) VALUES (1)")
        conn.execute(
            f"UPDATE wealth_plan SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
            tuple(fields.values()),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM wealth_plan WHERE id = 1").fetchone()
    return dict(row)


def _month_iter(start_ym: str, end_ym: str):
    y, m = int(start_ym[:4]), int(start_ym[5:7])
    ey, em = int(end_ym[:4]), int(end_ym[5:7])
    while (y, m) <= (ey, em):
        yield f"{y:04d}-{m:02d}"
        m += 1
        if m > 12:
            m = 1
            y += 1


def _normalize_month(ym: Optional[str]) -> Optional[str]:
    """Accept '2028', '2028-6', '2028-06', '2028-06-15'; return canonical 'YYYY-MM' or None."""
    if not ym:
        return None
    s = str(ym).strip()
    if not s:
        return None
    import re as _re
    m = _re.match(r'^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$', s)
    if not m:
        return None
    year = m.group(1)
    mon = m.group(2) or '12'
    return f"{year}-{int(mon):02d}"


@app.get("/api/plan/simulate")
def api_plan_simulate(
    acacia_sale_price_override: Optional[float] = None,
    acacia_sale_month_delta: Optional[int] = None,  # months shift; e.g. -3 = 3 mo earlier
    lind_build_cost_override: Optional[float] = None,
    lind_sale_price_override: Optional[float] = None,
    lind_sale_month_delta: Optional[int] = None,
    nicole_income_override: Optional[float] = None,
    avg_apy_override: Optional[float] = None,
):
    """Month-by-month cashflow simulation with optional sensitivity overrides.

    Now also surfaces:
      - `project_spend` per project (actuals to date)
      - `health`: green/amber/red based on min-cash + warnings
      - `events` list for chart annotations (Acacia sale, Lind sale, retirement)
    """
    _, fx = _fx_cache()
    with get_db_connection() as conn:
        plan_row = conn.execute("SELECT * FROM wealth_plan WHERE id = 1").fetchone()
        if not plan_row:
            return {'error': 'no plan'}
        plan = dict(plan_row)

        # Starting cash (savings + checking, AUD-equivalent)
        cash_rows = conn.execute(
            "SELECT current_balance, currency FROM accounts "
            "WHERE is_active=1 AND type IN ('savings','checking')"
        ).fetchall()
        starting_cash = sum((r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD') for r in cash_rows)

        # Baseline burn = last 3 months median living spend (excludes Investment + project-tagged spend)
        baseline_burn = 0.0
        try:
            burn_rows = conn.execute(
                """SELECT -SUM(amount) AS spend FROM transactions
                   WHERE amount < 0 AND transaction_type != 'transfer'
                     AND category != 'Investment' AND project_id IS NULL
                     AND transaction_date >= date('now', '-3 months')
                     AND currency='AUD'
                   GROUP BY strftime('%Y-%m', transaction_date)"""
            ).fetchall()
            spends = sorted([(r['spend'] or 0) for r in burn_rows])
            baseline_burn = spends[len(spends) // 2] if spends else 0
        except Exception:
            pass

        # Project spend-to-date (actuals)
        project_spend = {}
        for pr in conn.execute("SELECT id, name FROM projects").fetchall():
            total_row = conn.execute(
                "SELECT COALESCE(-SUM(amount),0) AS total, COUNT(*) AS n "
                "FROM transactions WHERE project_id = ? AND amount < 0",
                (pr['id'],),
            ).fetchone()
            project_spend[pr['name']] = {
                'project_id': pr['id'],
                'spent_to_date': round(total_row['total'], 2),
                'transaction_count': total_row['n'],
            }

        # Structured recurring income (Nicole's salary + savings-account interest).
        # These are real, ongoing inflows that don't reliably show up in the
        # transactions table, so we model them here.
        # Nicole is casual — income varies. Use MIN for conservative survival math.
        nicole_min = plan.get('nicole_income_monthly_min') or plan.get('nicole_income_monthly') or 0.0
        nicole_max = plan.get('nicole_income_monthly_max') or plan.get('nicole_income_monthly') or nicole_min
        nicole_monthly = nicole_min  # conservative default
        if nicole_income_override is not None:
            nicole_monthly = float(nicole_income_override)
        interest_rows = conn.execute(
            "SELECT current_balance, currency, apy, name FROM accounts "
            "WHERE is_active=1 AND type IN ('savings','checking') AND COALESCE(apy, 0) > 0"
        ).fetchall()
        interest_monthly = 0.0
        for r in interest_rows:
            bal_aud = (r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD')
            interest_monthly += bal_aud * (r['apy'] or 0) / 100.0 / 12.0
        if avg_apy_override is not None:
            total_cash = sum((r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD') for r in cash_rows)
            interest_monthly = total_cash * float(avg_apy_override) / 100.0 / 12.0

        # Crypto staking rewards — pull from the same source of truth used by
        # /api/advisor/runway so the plan trajectory doesn't silently understate
        # income by ~$596/mo (ETH + SOL).  Best-effort: if the staking endpoints
        # are temporarily rate-limited and return 0, the plan still simulates
        # without the staking contribution rather than crashing.
        staking_monthly_plan = 0.0
        try:
            for a in [x.strip() for x in os.getenv('CRYPTO_STAKING_ADDRESSES', '0x456099f8DE31c594CA40c8D868237e75ECc03d1e').split(',') if x.strip()]:
                staking_monthly_plan += (_fetch_eth_staking(a).get('monthly_aud') or 0)
            for a in [x.strip() for x in os.getenv('SOLANA_STAKING_WALLET', '').split(',') if x.strip()]:
                staking_monthly_plan += (_fetch_solana_staking(a).get('monthly_aud') or 0)
        except Exception as _e:
            logger.warning(f"plan-sim staking lookup failed: {_e}")

        structured_income_monthly = nicole_monthly + interest_monthly + staking_monthly_plan

        # Post-retirement burn override
        post_retire_burn = plan.get('retirement_monthly_spend') or baseline_burn
        post_retire_income = plan.get('retirement_income_monthly') or 0

    # Normalize months on read so "2028" works like "2028-12"
    acacia_sale_ym = _normalize_month(plan.get('acacia_target_sale_month'))
    lind_sale_ym = _normalize_month(plan.get('lind_target_sale_month'))
    lind_build_start_ym = _normalize_month(plan.get('lind_build_start_month'))
    lind_build_end_ym = _normalize_month(plan.get('lind_build_end_month'))
    retire_ym = _normalize_month(plan.get('retirement_start_month')) or '2030-12'

    # Apply sensitivity overrides
    acacia_sale_price = acacia_sale_price_override if acacia_sale_price_override is not None else (plan.get('acacia_target_sale_price') or 0)
    lind_sale_price = lind_sale_price_override if lind_sale_price_override is not None else (plan.get('lind_target_sale_price') or 0)
    lind_build_cost = lind_build_cost_override if lind_build_cost_override is not None else (plan.get('lind_build_cost') or 0)

    def _shift(ym: Optional[str], delta_months: int) -> Optional[str]:
        if not ym:
            return ym
        y, m = int(ym[:4]), int(ym[5:7])
        total = (y * 12 + (m - 1)) + delta_months
        y2, m2 = total // 12, (total % 12) + 1
        return f"{y2:04d}-{m2:02d}"

    if acacia_sale_month_delta:
        acacia_sale_ym = _shift(acacia_sale_ym, acacia_sale_month_delta)
    if lind_sale_month_delta:
        lind_sale_ym = _shift(lind_sale_ym, lind_sale_month_delta)

    now_ym = datetime.utcnow().strftime('%Y-%m')
    candidates = ['2030-12', retire_ym]
    if lind_sale_ym: candidates.append(lind_sale_ym)
    end_ym = max(candidates)

    def spread(total, start_ym, end_ym_incl):
        if not total or not start_ym or not end_ym_incl:
            return {}
        months = list(_month_iter(start_ym, end_ym_incl))
        if not months:
            return {}
        per = total / len(months)
        return {m: per for m in months}

    acacia_spread = spread(
        plan.get('acacia_reno_remaining') or 0,
        now_ym,
        acacia_sale_ym or now_ym,
    )
    lind_spread = spread(
        lind_build_cost,
        lind_build_start_ym or now_ym,
        lind_build_end_ym or lind_sale_ym or now_ym,
    )

    # Simulate
    cash = starting_cash
    series = []
    warnings = []
    for ym in _month_iter(now_ym, end_ym):
        if retire_ym and ym >= retire_ym:
            burn = post_retire_burn - post_retire_income
            income_monthly = post_retire_income
        else:
            # Pre-retirement: living spend minus Nicole's salary + savings interest.
            burn = baseline_burn - structured_income_monthly
            income_monthly = structured_income_monthly
        reno_spend = acacia_spread.get(ym, 0)
        build_spend = lind_spread.get(ym, 0)
        sale_in = 0.0
        if ym == acacia_sale_ym: sale_in += acacia_sale_price
        if ym == lind_sale_ym: sale_in += lind_sale_price
        if ym == retire_ym: sale_in -= (plan.get('retirement_prep_cost') or 0)
        net_month = -burn - reno_spend - build_spend + sale_in
        cash += net_month

        status = 'ok'
        if cash < 0: status = 'break'
        elif cash < 50000: status = 'tight'
        if status != 'ok':
            warnings.append({'month': ym, 'cash': round(cash, 0), 'status': status})

        series.append({
            'month': ym,
            'burn': round(burn, 0),
            'income': round(income_monthly, 0),
            'reno_spend': round(reno_spend, 0),
            'build_spend': round(build_spend, 0),
            'sale_in': round(sale_in, 0),
            'net_month': round(net_month, 0),
            'cash': round(cash, 0),
            'status': status,
        })

    min_cash = min(s['cash'] for s in series) if series else starting_cash
    min_cash_month = min(series, key=lambda s: s['cash'])['month'] if series else None
    ending_cash = series[-1]['cash'] if series else starting_cash
    has_break = any(s['status'] == 'break' for s in series)
    has_tight = any(s['status'] == 'tight' for s in series)
    health = 'red' if has_break else ('amber' if has_tight else 'green')

    events = []
    if acacia_sale_ym and acacia_sale_price:
        events.append({'month': acacia_sale_ym, 'label': f'Acacia sale ${acacia_sale_price/1000:.0f}k', 'amount': acacia_sale_price, 'kind': 'sale'})
    if lind_sale_ym and lind_sale_price:
        events.append({'month': lind_sale_ym, 'label': f'Lind sale ${lind_sale_price/1000:.0f}k', 'amount': lind_sale_price, 'kind': 'sale'})
    if retire_ym:
        events.append({'month': retire_ym, 'label': 'Retirement', 'kind': 'retire'})

    return {
        'starting_cash': round(starting_cash, 0),
        'baseline_burn': round(baseline_burn, 0),
        'structured_income_monthly': round(structured_income_monthly, 2),
        'nicole_income_monthly': round(nicole_monthly, 2),
        'nicole_income_monthly_min': round(nicole_min, 2),
        'nicole_income_monthly_max': round(nicole_max, 2),
        'interest_monthly': round(interest_monthly, 2),
        'staking_monthly': round(staking_monthly_plan, 2),
        'net_monthly_before_projects': round(structured_income_monthly - baseline_burn, 2),
        'retire_month': retire_ym,
        'end_month': end_ym,
        'series': series,
        'warnings': warnings,
        'min_cash': round(min_cash, 0),
        'min_cash_month': min_cash_month,
        'ending_cash': round(ending_cash, 0),
        'project_spend': project_spend,
        'health': health,
        'events': events,
        'overrides_applied': any(v is not None for v in [
            acacia_sale_price_override, acacia_sale_month_delta,
            lind_build_cost_override, lind_sale_price_override, lind_sale_month_delta,
            nicole_income_override, avg_apy_override,
        ]),
    }


# --- Plan Scenarios (save/load) ---

class PlanScenarioIn(BaseModel):
    name: str
    description: Optional[str] = None


@app.get("/api/plan/scenarios")
def api_plan_scenarios_list():
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, description, created_at FROM plan_scenarios ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/plan/scenarios")
def api_plan_scenarios_save(payload: PlanScenarioIn):
    """Snapshot the current wealth_plan as a named scenario."""
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="name required")
    with get_db_connection() as conn:
        plan_row = conn.execute("SELECT * FROM wealth_plan WHERE id = 1").fetchone()
        if not plan_row:
            raise HTTPException(status_code=404, detail="no plan to snapshot")
        import json as _json
        snap = {k: plan_row[k] for k in plan_row.keys()}
        # drop non-serializable
        snap.pop('updated_at', None)
        snap_json = _json.dumps(snap, default=str)
        try:
            cur = conn.execute(
                "INSERT INTO plan_scenarios (name, description, snapshot_json) VALUES (?, ?, ?)",
                (payload.name.strip(), payload.description, snap_json),
            )
        except sqlite3.IntegrityError:
            # Name exists — overwrite
            cur = conn.execute(
                "UPDATE plan_scenarios SET description=?, snapshot_json=?, created_at=CURRENT_TIMESTAMP WHERE name=?",
                (payload.description, snap_json, payload.name.strip()),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM plan_scenarios WHERE name=?", (payload.name.strip(),)).fetchone()
        return dict(row)


@app.post("/api/plan/scenarios/{scenario_id}/load")
def api_plan_scenarios_load(scenario_id: int):
    """Restore a saved scenario into wealth_plan (overwriting current)."""
    import json as _json
    with get_db_connection() as conn:
        row = conn.execute("SELECT snapshot_json FROM plan_scenarios WHERE id=?", (scenario_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="scenario not found")
        snap = _json.loads(row['snapshot_json'])
        snap.pop('id', None)
        set_clauses = [f"{k}=?" for k in snap.keys()]
        conn.execute(
            f"UPDATE wealth_plan SET {', '.join(set_clauses)} WHERE id = 1",
            tuple(snap.values()),
        )
        conn.commit()
    return {"loaded": scenario_id}


@app.delete("/api/plan/scenarios/{scenario_id}")
def api_plan_scenarios_delete(scenario_id: int):
    with get_db_connection() as conn:
        cur = conn.execute("DELETE FROM plan_scenarios WHERE id=?", (scenario_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="not found")
        conn.commit()
    return {"deleted": scenario_id}


@app.post("/api/plan/auto-fill")
def api_plan_auto_fill():
    """Fill blanks in wealth_plan using known data sources:
      - acacia_current_value ← holdings.REAL_ESTATE_4 current_price (18 Acacia)
      - lind_current_value   ← holdings.REAL_ESTATE_1 current_price (27 Lind)
      - retirement_monthly_spend ← baseline burn from runway
    Non-destructive: only fills fields that are currently NULL.
    """
    import re as _re
    with get_db_connection() as conn:
        plan = dict(conn.execute("SELECT * FROM wealth_plan WHERE id = 1").fetchone())
        updates: Dict[str, object] = {}

        # Acacia value
        if plan.get('acacia_current_value') is None:
            r = conn.execute(
                "SELECT current_price FROM holdings WHERE asset_name LIKE '%Acacia%' LIMIT 1"
            ).fetchone()
            if r and r['current_price']:
                updates['acacia_current_value'] = r['current_price']

        # Lind value
        if plan.get('lind_current_value') is None:
            r = conn.execute(
                "SELECT current_price FROM holdings WHERE asset_name LIKE '%Lind%' LIMIT 1"
            ).fetchone()
            if r and r['current_price']:
                updates['lind_current_value'] = r['current_price']

        # Normalize any invalid month strings already stored
        for col in ('acacia_target_sale_month', 'lind_build_start_month', 'lind_build_end_month',
                    'lind_target_sale_month', 'retirement_start_month'):
            val = plan.get(col)
            if val and not _re.match(r'^\d{4}-\d{2}$', str(val)):
                norm = _normalize_month(val)
                if norm:
                    updates[col] = norm

        # Retirement monthly spend default
        if plan.get('retirement_monthly_spend') is None:
            burn_rows = conn.execute(
                """SELECT -SUM(amount) AS spend FROM transactions
                   WHERE amount < 0 AND transaction_type != 'transfer'
                     AND category != 'Investment' AND project_id IS NULL
                     AND transaction_date >= date('now', '-3 months')
                     AND currency='AUD'
                   GROUP BY strftime('%Y-%m', transaction_date)"""
            ).fetchall()
            spends = sorted([(r['spend'] or 0) for r in burn_rows])
            if spends:
                updates['retirement_monthly_spend'] = round(spends[len(spends) // 2], 2)

        if updates:
            set_clauses = [f"{k}=?" for k in updates.keys()]
            conn.execute(
                f"UPDATE wealth_plan SET {', '.join(set_clauses)}, updated_at=CURRENT_TIMESTAMP WHERE id = 1",
                tuple(updates.values()),
            )
            conn.commit()

    return {"updated_fields": updates}


# ============================================================================
# Goals — CRUD + AI suggestion
# ============================================================================
class GoalIn(BaseModel):
    name: str
    kind: Optional[str] = 'user'
    target_amount: Optional[float] = None
    current_amount: Optional[float] = None
    target_date: Optional[str] = None
    monthly_contribution: Optional[float] = None
    rationale: Optional[str] = None
    status: Optional[str] = 'active'
    notes: Optional[str] = None


@app.get("/api/goals")
def api_list_goals():
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, kind, target_amount, current_amount, target_date, "
            "monthly_contribution, rationale, status, notes, created_at, updated_at "
            "FROM goals ORDER BY status='done', created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/goals")
def api_create_goal(g: GoalIn):
    with get_db_connection() as conn:
        cur = conn.execute(
            "INSERT INTO goals (name, kind, target_amount, current_amount, target_date, "
            "monthly_contribution, rationale, status, notes) VALUES (?,?,?,?,?,?,?,?,?)",
            (g.name, g.kind or 'user', g.target_amount or 0, g.current_amount,
             g.target_date, g.monthly_contribution, g.rationale, g.status or 'active', g.notes),
        )
        conn.commit()
        return {"id": cur.lastrowid}


@app.put("/api/goals/{goal_id}")
def api_update_goal(goal_id: int, g: GoalIn):
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE goals SET name=?, kind=?, target_amount=?, current_amount=?, target_date=?, "
            "monthly_contribution=?, rationale=?, status=?, notes=?, updated_at=datetime('now') "
            "WHERE id=?",
            (g.name, g.kind or 'user', g.target_amount or 0, g.current_amount,
             g.target_date, g.monthly_contribution, g.rationale, g.status or 'active', g.notes, goal_id),
        )
        conn.commit()
    return {"updated": goal_id}


@app.delete("/api/goals/{goal_id}")
def api_delete_goal(goal_id: int):
    with get_db_connection() as conn:
        conn.execute("DELETE FROM goals WHERE id=?", (goal_id,))
        conn.commit()
    return {"deleted": goal_id}


@app.post("/api/goals/ai-suggest")
def api_ai_goals_suggest():
    """Kimi reads current position + plan and proposes 3-5 goals for drawdown mode."""
    with get_db_connection() as conn:
        plan_row = conn.execute("SELECT * FROM wealth_plan WHERE id=1").fetchone()
        nw = conn.execute(
            "SELECT COALESCE(SUM(current_balance * "
            "(CASE WHEN currency='AUD' THEN 1 ELSE 0.65 END)),0) AS cash FROM accounts WHERE is_active=1 AND type IN ('savings','checking')"
        ).fetchone()
        plan = dict(plan_row) if plan_row else {}
        cash = nw['cash'] if nw else 0

    system = (
        "You are advising Christopher & Nicole Howell (Australian, DRAWDOWN mode — not working, living off savings). "
        "Nicole earns $3,500-4,500/mo casual. Plan: finish 18 Acacia Dr Tasmania reno (~$10k remaining) → sell $450k target → fund 27 Lind Ave Southport build ($700k build, $2.4M sale 2028-12) → retire Ansons Bay Tasmania 2030-12. "
        "Suggest concrete SMART goals tied to their plan, not aspirational."
    )
    user = (
        f"Cash: ~${int(cash):,} AUD. Rabobank interest ~$1,982/mo. Wise JPY at 0% = opportunity.\n\n"
        "Return 3-5 goals as PURE JSON (no markdown fences):\n"
        '{"goals":[{"name":"<title>","target_amount_aud":<number|null>,"target_date":"YYYY-MM-DD|null",'
        '"monthly_contribution_aud":<number|null>,"rationale":"<1-2 sentences>"}]}'
    )
    raw = _kimi_chat(system, user, max_tokens=12000, temperature=1)
    if not raw:
        raise HTTPException(502, "AI provider unavailable")
    try:
        txt = raw.strip()
        if txt.startswith('```'):
            import re as _re
            txt = _re.sub(r'^```(?:json)?\s*', '', txt)
            txt = _re.sub(r'\s*```\s*$', '', txt)
        i, j = txt.find('{'), txt.rfind('}')
        parsed = json.loads(txt[i:j+1]) if i >= 0 and j > i else {}
        return {"goals": parsed.get("goals", []), "source": "kimi"}
    except Exception as e:
        raise HTTPException(502, f"AI parse failed: {e}")


@app.post("/api/budgets/ai-generate")
def api_ai_budgets_generate():
    """Kimi reads 12mo spend-by-category and proposes realistic monthly budgets for drawdown."""
    with get_db_connection() as conn:
        rows = conn.execute(
            """SELECT COALESCE(category,'Uncategorised') AS category,
                      COALESCE(currency,'AUD') AS ccy,
                      -SUM(amount)/12.0 AS avg_monthly
               FROM transactions
               WHERE amount < 0 AND transaction_type != 'transfer'
                 AND category != 'Investment' AND project_id IS NULL
                 AND transaction_date >= date('now','-12 months')
               GROUP BY category, ccy
               ORDER BY avg_monthly DESC
               LIMIT 20"""
        ).fetchall()
    spend = [{"category": r['category'], "current_monthly_avg_aud": round((r['avg_monthly'] or 0) * (1 if r['ccy'] == 'AUD' else 0.65), 0)} for r in rows]

    system = (
        "You are budget-coaching Christopher & Nicole (Australian, DRAWDOWN mode). "
        "They want realistic monthly budgets — NOT aspirational, NOT starvation. Identify where 10-20% cuts are plausible without hurting quality of life."
    )
    user = (
        "12-month spending average per category:\n"
        + json.dumps(spend, indent=2) + "\n\n"
        "For each category, suggest a monthly budget AUD and estimate reduction potential. Return PURE JSON:\n"
        '{"budgets":[{"category":"<name>","suggested_monthly_aud":<n>,"current_monthly_avg_aud":<n>,'
        '"reduction_potential_aud":<n>,"rationale":"<1 sentence why this target is achievable>"}]}'
    )
    raw = _kimi_chat(system, user, max_tokens=12000, temperature=1)
    if not raw:
        raise HTTPException(502, "AI provider unavailable")
    try:
        txt = raw.strip()
        if txt.startswith('```'):
            import re as _re
            txt = _re.sub(r'^```(?:json)?\s*', '', txt)
            txt = _re.sub(r'\s*```\s*$', '', txt)
        i, j = txt.find('{'), txt.rfind('}')
        parsed = json.loads(txt[i:j+1]) if i >= 0 and j > i else {}
        budgets = parsed.get("budgets", [])
        # Cache to ai_budgets
        with get_db_connection() as conn:
            conn.execute("DELETE FROM ai_budgets")
            for b in budgets:
                conn.execute(
                    "INSERT INTO ai_budgets (category, suggested_monthly_aud, current_monthly_avg_aud, "
                    "reduction_potential_aud, rationale) VALUES (?,?,?,?,?)",
                    (b.get('category'), b.get('suggested_monthly_aud') or 0,
                     b.get('current_monthly_avg_aud') or 0, b.get('reduction_potential_aud') or 0,
                     b.get('rationale')),
                )
            conn.commit()
        return {"budgets": budgets, "source": "kimi"}
    except Exception as e:
        raise HTTPException(502, f"AI parse failed: {e}")


@app.get("/api/budgets/ai-cached")
def api_ai_budgets_cached():
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT category, suggested_monthly_aud, current_monthly_avg_aud, "
            "reduction_potential_aud, rationale, generated_at FROM ai_budgets ORDER BY suggested_monthly_aud DESC"
        ).fetchall()
    return [dict(r) for r in rows]


# ============================================================================
# Rebalance targets — persisted slider values
# ============================================================================
class RebalanceTargetsIn(BaseModel):
    real_estate_pct: float
    cash_yielding_pct: float
    crypto_pct: float
    stocks_pct: float
    other_pct: float


@app.get("/api/rebalance/targets")
def api_rebalance_targets_get():
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM rebalance_targets WHERE id=1").fetchone()
    if not row:
        return {"real_estate_pct": 25, "cash_yielding_pct": 35, "crypto_pct": 30, "stocks_pct": 10, "other_pct": 0}
    return dict(row)


@app.put("/api/rebalance/targets")
def api_rebalance_targets_put(t: RebalanceTargetsIn):
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE rebalance_targets SET real_estate_pct=?, cash_yielding_pct=?, crypto_pct=?, "
            "stocks_pct=?, other_pct=?, updated_at=datetime('now') WHERE id=1",
            (t.real_estate_pct, t.cash_yielding_pct, t.crypto_pct, t.stocks_pct, t.other_pct),
        )
        conn.commit()
    return {"ok": True}


# ============================================================================
# Validator performance network reference APYs
#
# These constants feed the Validator Performance Monitor intel — each staking
# endpoint compares user's implied APY to these reference rates and reports a
# gap. Sourced periodically from public stake-return dashboards (beaconcha.in
# for ETH, solanabeach.io / stakewiz.com for SOL).  Review every 6-12 months
# or when a material regime shift happens (e.g. major fee-burn change).
#
# ETH reference: Ethereum mean validator APR 2026-Q2 ~3.2%.
# SOL reference: Solana network weighted-mean staking APY 2026-Q2 ~6.5%.
# ============================================================================
ETH_NETWORK_APY_REF = 3.2   # %
SOL_NETWORK_APY_REF = 6.5   # %

# ============================================================================
# ETH staking rewards via Etherscan (graceful if no key)
# ============================================================================
_STAKING_CACHE: Dict[str, Dict] = {}
_STAKING_CACHE_TTL = 3600  # 1h

def _fetch_eth_staking(address: str) -> Dict:
    """Fetch staking / reward history for an address. Aggregates monthly AUD."""
    import time as _time
    now = _time.time()
    cached = _STAKING_CACHE.get(address)
    if cached and now - cached['t'] < _STAKING_CACHE_TTL:
        return cached['data']

    key = os.environ.get('ETHERSCAN_API_KEY', '')
    if not key:
        data = {"address": address, "monthly_aud": 0, "transactions": 0, "note": "ETHERSCAN_API_KEY not configured"}
        _STAKING_CACHE[address] = {'t': now, 'data': data}
        return data

    try:
        import urllib.request, urllib.parse, ssl as _ssl
        try:
            import certifi
            ctx = _ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            ctx = _ssl.create_default_context()

        def _etherscan(action: str) -> dict:
            # Etherscan V2 (unified multichain). chainid=1 = Ethereum mainnet.
            # Iteration 23: per-call timeout cut from 15s → 5s. The outer loop
            # already breaks on the first action that returns rewards, so the
            # worst-case fan-out is 3 × 5s = 15s per cold address (was 45s).
            url = f"https://api.etherscan.io/v2/api?chainid=1&module=account&action={action}&address={urllib.parse.quote(address)}&startblock=0&endblock=99999999&sort=desc&apikey={urllib.parse.quote(key)}"
            req = urllib.request.Request(url, headers={'User-Agent': 'WealthGuard/1.0'})
            with urllib.request.urlopen(req, timeout=5, context=ctx) as resp:
                return json.loads(resp.read().decode())

        # ETH2 staking rewards land as beacon withdrawals (post-Shapella).
        # Compute 30d / 90d / 12mo sums + the smoothed monthly income figure.
        note = None
        rewards: list = []
        for action in ('txsBeaconWithdrawal', 'txlistinternal', 'txlist'):
            j = _etherscan(action)
            if j.get('status') != '1':
                note = j.get('message') or note
                continue
            for t in j.get('result', [])[:3000]:
                recipient = (t.get('address') or t.get('to') or '').lower()
                if recipient != address.lower():
                    continue
                ts = int(t.get('timestamp') or t.get('timeStamp') or 0)
                try:
                    if 'amount' in t:   # beacon withdrawal (gwei)
                        wei = int(t['amount']) * 1_000_000_000
                    else:               # normal/internal tx (wei)
                        wei = int(t.get('value', 0))
                    if wei > 0 and ts > 0:
                        rewards.append((ts, wei))
                except Exception:
                    continue
            if rewards:
                break

        if not rewards:
            # Etherscan transient failure — fall back to last-known value if any,
            # and cache any zero result for only 5 minutes instead of 1 hour so
            # we retry soon.
            prev_good = (cached['data'] if cached else None)
            if prev_good and (prev_good.get('monthly_aud') or 0) > 0:
                data = dict(prev_good)
                data['note'] = f"stale: {note or 'etherscan empty'}; last-known value shown"
                _STAKING_CACHE[address] = {'t': now - (_STAKING_CACHE_TTL - 300), 'data': data}
                return data
            data = {"address": address, "monthly_aud": 0, "transactions": 0, "note": note or "no rewards in wallet history"}
            _STAKING_CACHE[address] = {'t': now - (_STAKING_CACHE_TTL - 300), 'data': data}
            return data

        def _sum_window(days: int) -> tuple:
            cutoff = now - days * 86400
            wei = sum(w for ts, w in rewards if ts >= cutoff)
            cnt = sum(1 for ts, w in rewards if ts >= cutoff)
            return wei, cnt

        wei_30, cnt_30 = _sum_window(30)
        wei_90, cnt_90 = _sum_window(90)
        wei_365, cnt_365 = _sum_window(365)
        eth_30  = wei_30  / 1e18
        eth_90  = wei_90  / 1e18
        eth_365 = wei_365 / 1e18

        # ETH AUD price from holdings table (native is USD → × FX).
        with get_db_connection() as conn:
            eth_row = conn.execute("SELECT current_price, native_currency FROM holdings WHERE UPPER(symbol)='ETH' LIMIT 1").fetchone()
        _, fx = _fx_cache()
        px_aud = 3500.0
        if eth_row and eth_row['current_price']:
            ccy = (eth_row['native_currency'] or 'USD').upper()
            px_aud = eth_row['current_price'] * fx(ccy, 'AUD')

        aud_30 = eth_30 * px_aud
        aud_90 = eth_90 * px_aud
        aud_365 = eth_365 * px_aud

        # Smoothed monthly figure = 12-month mean (or 90d mean fallback if <1yr history)
        if eth_365 > 0:
            monthly_aud = aud_365 / 12
            basis = "12mo avg"
        elif eth_90 > 0:
            monthly_aud = aud_90 / 3
            basis = "90d avg"
        else:
            monthly_aud = aud_30
            basis = "30d"

        # Validator performance intel — compare user's implied APY to the
        # Ethereum network's current mean validator APR (~3.2% in 2026).
        # Requires knowing how much ETH is staked. Pull from holdings table
        # (user's total ETH position is fully staked per CLAUDE.md).
        eth_staked = 0.0
        try:
            with get_db_connection() as conn:
                row = conn.execute(
                    "SELECT shares FROM holdings WHERE UPPER(symbol) = 'ETH' AND asset_class = 'crypto' LIMIT 1"
                ).fetchone()
            if row and row['shares']:
                eth_staked = float(row['shares'])
        except Exception:
            pass

        implied_apy_pct = (eth_365 / eth_staked * 100) if eth_staked > 0 and eth_365 > 0 else 0.0
        network_apy_pct = ETH_NETWORK_APY_REF
        apy_gap_pct = implied_apy_pct - network_apy_pct   # negative = underperforming
        # Annualised $ gap = stake_value * gap% at current price
        staked_value_aud = eth_staked * px_aud
        gap_annual_aud = staked_value_aud * (apy_gap_pct / 100.0)
        status = (
            'outperforming' if apy_gap_pct > 0.25 else
            'underperforming' if apy_gap_pct < -0.25 else
            'on_par'
        )

        data = {
            "address": address,
            "monthly_aud": round(monthly_aud, 2),
            "basis": basis,
            "eth_30d":  round(eth_30,  6), "aud_30d":  round(aud_30,  2), "txs_30d":  cnt_30,
            "eth_90d":  round(eth_90,  6), "aud_90d":  round(aud_90,  2), "txs_90d":  cnt_90,
            "eth_365d": round(eth_365, 6), "aud_365d": round(aud_365, 2), "txs_365d": cnt_365,
            "transactions": cnt_30,       # backward compat
            "price_aud_per_eth": round(px_aud, 2),
            # Validator intel (NEW)
            "eth_staked": round(eth_staked, 6),
            "staked_value_aud": round(staked_value_aud, 2),
            "implied_apy_pct": round(implied_apy_pct, 3),
            "network_apy_pct": network_apy_pct,
            "apy_gap_pct": round(apy_gap_pct, 3),
            "gap_annual_aud": round(gap_annual_aud, 2),
            "validator_status": status,
        }
        _STAKING_CACHE[address] = {'t': now, 'data': data}
        return data
    except Exception as e:
        return {"address": address, "monthly_aud": 0, "transactions": 0, "note": f"fetch error: {e}"}


@app.get("/api/crypto/staking-rewards")
def api_staking_rewards(address: Optional[str] = None):
    addr = address or "0x456099f8DE31c594CA40c8D868237e75ECc03d1e"
    return _fetch_eth_staking(addr)


# ============================================================================
# Solana staking rewards — via public Solana RPC (getInflationReward)
# ============================================================================
# Why not Solscan: their free-tier Pro API no longer covers /account/* endpoints
# ("Unauthorized: Please upgrade your api key level"). Public Solana RPC gives
# us per-epoch stake rewards for free and is what Solana Beach / Stakewiz use
# under the hood.  Each epoch ≈ 2.5 days, so ~12 epochs ≈ 1 month.
# ============================================================================
_SOL_STAKING_CACHE: Dict[str, Dict] = {}
_SOL_RPC_URLS = [
    "https://api.mainnet-beta.solana.com",
]

def _fetch_solana_staking(wallet: str) -> Dict:
    """Fetch stake-account rewards via public Solana RPC `getInflationReward`.

    `wallet` must be a STAKE ACCOUNT address (not a regular wallet) — this is
    what `SOLANA_STAKING_WALLET` in .env is documented to hold.  Samples the
    last 36 epochs (~90 days), extrapolates to monthly AUD, and caches 1h.
    """
    import time as _time
    now = _time.time()
    cached = _SOL_STAKING_CACHE.get(wallet)
    if cached and now - cached['t'] < _STAKING_CACHE_TTL:
        return cached['data']

    try:
        import urllib.request, ssl as _ssl
        try:
            import certifi
            ctx = _ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            ctx = _ssl.create_default_context()

        # Prefer Helius if a key is set (higher rate-limits), else public RPC.
        helius = os.environ.get('HELIUS_API_KEY', '').strip()
        rpc_url = (
            f"https://mainnet.helius-rpc.com/?api-key={helius}"
            if helius else _SOL_RPC_URLS[0]
        )

        def _rpc(method: str, params, retries: int = 2):
            body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
            last_err: Optional[Exception] = None
            for attempt in range(retries + 1):
                try:
                    req = urllib.request.Request(
                        rpc_url,
                        data=body,
                        headers={'Content-Type': 'application/json', 'User-Agent': 'WealthGuard/1.0'},
                    )
                    with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                        return json.loads(resp.read().decode())
                except urllib.error.HTTPError as he:
                    last_err = he
                    if he.code in (429, 502, 503):
                        _time.sleep(0.5 + attempt * 0.5)
                        continue
                    raise
                except Exception as e:
                    last_err = e
                    _time.sleep(0.3)
                    continue
            if last_err:
                raise last_err
            return {}

        # 1. Confirm stake account + pull delegated stake
        info = _rpc("getAccountInfo", [wallet, {"encoding": "jsonParsed"}])
        value = ((info.get('result') or {}).get('value')) or {}
        parsed = (((value.get('data') or {}).get('parsed')) or {})
        is_stake = (parsed.get('type') == 'delegated')
        delegation = (((parsed.get('info') or {}).get('stake') or {}).get('delegation') or {})
        delegated_lamports = int(delegation.get('stake') or 0)
        delegated_sol = delegated_lamports / 1e9
        voter = delegation.get('voter') or ''

        if not is_stake:
            data = {
                "address": wallet, "monthly_aud": 0, "transactions": 0,
                "note": "not a delegated stake account (use the stake-account address, not the wallet)",
            }
            _SOL_STAKING_CACHE[wallet] = {'t': now, 'data': data}
            return data

        # 2. Sample recent epochs
        ep_info = _rpc("getEpochInfo", []).get('result') or {}
        current_epoch = int(ep_info.get('epoch') or 0)
        # Skip the current epoch (rewards not posted yet) and the one before
        # (sometimes still finalising).  Go back 24 completed epochs ≈ 60 days —
        # enough to smooth out epoch-to-epoch variation without hammering the
        # public RPC into rate-limit territory.
        SAMPLE_EPOCHS = 24
        start_epoch = max(1, current_epoch - 2 - SAMPLE_EPOCHS + 1)
        end_epoch = current_epoch - 2

        rewards_sol: List[float] = []
        epochs_with_data: List[int] = []
        # Pacing between calls keeps public RPC from rate-limiting us.
        # Helius has generous limits, so only pace when using the public endpoint.
        delay = 0.0 if helius else 0.25
        consecutive_errors = 0
        for ep in range(end_epoch, start_epoch - 1, -1):
            try:
                r = _rpc("getInflationReward", [[wallet], {"epoch": ep}])
                arr = r.get('result') or []
                if arr and isinstance(arr[0], dict):
                    amt = int(arr[0].get('amount') or 0)
                    if amt > 0:
                        rewards_sol.append(amt / 1e9)
                        epochs_with_data.append(ep)
                consecutive_errors = 0
            except Exception:
                consecutive_errors += 1
                # Only bail after several consecutive failures AND a decent sample
                if consecutive_errors >= 3 and len(rewards_sol) >= 12:
                    break
                # Back off progressively on errors
                _time.sleep(min(consecutive_errors * 0.5, 2.0))
                continue
            if delay:
                _time.sleep(delay)

        if not rewards_sol:
            # Public RPC rate-limits hit — return the last known-good value if
            # we have one (so a transient failure doesn't wipe the cockpit),
            # otherwise return a 0 result BUT only cache it for 5 minutes so
            # we retry soon instead of locking in the failure for an hour.
            prev_good = (cached['data'] if cached else None)
            if prev_good and (prev_good.get('monthly_aud') or 0) > 0:
                data = dict(prev_good)
                data['note'] = 'stale: public RPC rate-limited; last-known value shown'
                _SOL_STAKING_CACHE[wallet] = {'t': now - (_STAKING_CACHE_TTL - 300), 'data': data}  # refresh in 5min
                return data
            data = {
                "address": wallet, "monthly_aud": 0, "transactions": 0,
                "note": "no reward history found in sampled epochs (public RPC rate-limited — set HELIUS_API_KEY for reliability)",
                "delegated_sol": round(delegated_sol, 6),
                "voter": voter,
                "sampled_epochs": f"{start_epoch}-{end_epoch}",
            }
            _SOL_STAKING_CACHE[wallet] = {'t': now - (_STAKING_CACHE_TTL - 300), 'data': data}  # retry in 5 min, not 1 hour
            return data

        # 3. Convert to AUD
        with get_db_connection() as conn:
            sol_row = conn.execute(
                "SELECT current_price, native_currency FROM holdings WHERE UPPER(symbol)='SOL' LIMIT 1"
            ).fetchone()
        _, fx = _fx_cache()
        px_aud = 85.0
        if sol_row and sol_row['current_price']:
            ccy = (sol_row['native_currency'] or 'USD').upper()
            px_aud = sol_row['current_price'] * fx(ccy, 'AUD')

        epochs_n = len(rewards_sol)
        sol_sampled = sum(rewards_sol)
        # Each epoch ≈ 2.5 days; ~12.17 epochs per month on average
        epochs_per_month = 12.17
        avg_sol_per_epoch = sol_sampled / max(epochs_n, 1)
        monthly_sol = avg_sol_per_epoch * epochs_per_month
        monthly_aud = monthly_sol * px_aud

        # Implied APY from this window
        apy = (avg_sol_per_epoch / delegated_sol * (365.25 / 2.5) * 100) if delegated_sol > 0 else 0.0

        # Validator performance intel — compare to SOL network mean (~6.5% 2026-Q2).
        # Negative gap = this validator is paying below network average; switch.
        network_apy_pct = SOL_NETWORK_APY_REF
        apy_gap_pct = apy - network_apy_pct
        staked_value_aud = delegated_sol * px_aud
        gap_annual_aud = staked_value_aud * (apy_gap_pct / 100.0)
        status = (
            'outperforming' if apy_gap_pct > 0.25 else
            'underperforming' if apy_gap_pct < -0.25 else
            'on_par'
        )

        data = {
            "address": wallet,
            "voter": voter,
            "delegated_sol": round(delegated_sol, 6),
            "delegated_aud": round(delegated_sol * px_aud, 2),
            "epochs_sampled": epochs_n,
            "sampled_epoch_range": f"{min(epochs_with_data)}-{max(epochs_with_data)}",
            "sol_sampled": round(sol_sampled, 6),
            "avg_sol_per_epoch": round(avg_sol_per_epoch, 8),
            "monthly_sol": round(monthly_sol, 6),
            "monthly_aud": round(monthly_aud, 2),
            "implied_apy_pct": round(apy, 3),
            "transactions": epochs_n,   # for structured_income count compat
            "basis": f"avg of last {epochs_n} epochs × 12.17/mo",
            "price_aud_per_sol": round(px_aud, 2),
            "rpc": ("helius" if helius else "public"),
            # Validator intel (NEW)
            "staked_value_aud": round(staked_value_aud, 2),
            "network_apy_pct": network_apy_pct,
            "apy_gap_pct": round(apy_gap_pct, 3),
            "gap_annual_aud": round(gap_annual_aud, 2),
            "validator_status": status,
        }
        _SOL_STAKING_CACHE[wallet] = {'t': now, 'data': data}
        return data
    except Exception as e:
        return {"address": wallet, "monthly_aud": 0, "transactions": 0, "note": f"fetch error: {e}"}


@app.get("/api/crypto/solana-staking-rewards")
def api_solana_staking(wallet: Optional[str] = None):
    addr = wallet or os.environ.get('SOLANA_STAKING_WALLET', '')
    if not addr:
        return {"monthly_aud": 0, "note": "pass ?wallet= or set SOLANA_STAKING_WALLET in .env"}
    return _fetch_solana_staking(addr)


_RUNWAY_CACHE: Dict[str, Dict] = {}  # keyed by f"{months_back}|{living_window}"
_RUNWAY_TTL = 60  # seconds — short because account balances change often
                  # (Portfolio edits, transaction imports). Long enough to make
                  # rapid page reloads instant.


@app.get("/api/advisor/runway")
def api_advisor_runway(
    months_back: int = 12,
    living_window: int = 3,
    force: bool = False,
):
    """Detailed cashflow + runway analysis.

    - `months_back`: months of history to use for average burn
    - `living_window`: rolling window (in months) for the "baseline living" burn
      (separates recurring life expenses from one-off project spend)
    - `force=True`: bust the 60-second cache and recompute (incl. external
      ETH/SOL staking fetches which can be slow on cold cache).

    Performance note (Iteration 23 fix): cold runway calls were taking ~108s
    because the synchronous staking helpers iterate 3 Etherscan endpoints
    (each with a 15s timeout) plus a Solana RPC call. After this iteration the
    runway response itself is cached for 60s; reload-the-page is instant. The
    very first call of a session still pays the cold-start cost, but subsequent
    consumers (Dashboard, useIncome, useRunway query, header chip) all hit the
    warm cache.
    """
    import time as _time
    cache_key = f"{months_back}|{living_window}"
    now_ts = _time.time()
    if not force:
        cached = _RUNWAY_CACHE.get(cache_key)
        if cached and (now_ts - cached['t']) < _RUNWAY_TTL:
            return _with_cache_meta(cached['data'], cached['t'], now_ts)

    _, fx = _fx_cache()
    with get_db_connection() as conn:
        # Pull monthly AUD-converted series, separating categories.
        # Exclude interest transactions from the income bucket — we recompute
        # interest separately from account APY × balance, so including both
        # would double-count Rabobank interest.
        rows = conn.execute(
            f"""SELECT strftime('%Y-%m', t.transaction_date) AS month,
                       COALESCE(t.currency,'AUD') AS ccy,
                       SUM(CASE WHEN t.amount > 0 AND t.transaction_type != 'transfer'
                                     AND LOWER(COALESCE(t.payee,'')) NOT LIKE '%interest%'
                                     AND LOWER(COALESCE(t.payee,'')) NOT LIKE '%bonus%'
                                THEN t.amount ELSE 0 END) AS income,
                       -SUM(CASE WHEN t.amount < 0 AND t.transaction_type != 'transfer' AND t.category = 'Investment' THEN t.amount ELSE 0 END) AS invest,
                       -SUM(CASE WHEN t.amount < 0 AND t.transaction_type != 'transfer' AND t.category != 'Investment' AND t.project_id IS NULL THEN t.amount ELSE 0 END) AS living,
                       -SUM(CASE WHEN t.amount < 0 AND t.transaction_type != 'transfer' AND t.project_id IS NOT NULL THEN t.amount ELSE 0 END) AS project_spend
                FROM transactions t
                WHERE t.transaction_date >= date('now', ?)
                GROUP BY month, ccy
                ORDER BY month""",
            (f'-{months_back} months',),
        ).fetchall()

        by_month: Dict[str, dict] = {}
        for r in rows:
            rate = fx(r['ccy'].upper(), 'AUD')
            m = r['month']
            agg = by_month.setdefault(m, {
                'month': m, 'income': 0.0, 'invest': 0.0,
                'living': 0.0, 'project_spend': 0.0,
            })
            for k in ('income', 'invest', 'living', 'project_spend'):
                agg[k] += (r[k] or 0) * rate

        series = sorted(by_month.values(), key=lambda x: x['month'])
        for s in series:
            s['net_living'] = round(s['income'] - s['living'], 2)
            for k in ('income', 'invest', 'living', 'project_spend'):
                s[k] = round(s[k], 2)

        # Baseline living burn: median of the last N months (more robust than mean).
        recent = [s['living'] for s in series[-living_window:]]
        baseline_living = sorted(recent)[len(recent) // 2] if recent else 0

        # True burn = baseline_living - baseline_income (income from transactions only).
        recent_income = [s['income'] for s in series[-living_window:]]
        txn_income = sorted(recent_income)[len(recent_income) // 2] if recent_income else 0

        # Structured recurring income — Nicole's salary + interest from savings accounts.
        # These don't always land as transactions, so we model them directly.
        plan_row = conn.execute(
            "SELECT nicole_income_monthly, nicole_income_monthly_min, nicole_income_monthly_max FROM wealth_plan WHERE id = 1"
        ).fetchone()
        nicole_min = (plan_row['nicole_income_monthly_min'] if plan_row else None) or (plan_row['nicole_income_monthly'] if plan_row else 0) or 0
        nicole_max = (plan_row['nicole_income_monthly_max'] if plan_row else None) or (plan_row['nicole_income_monthly'] if plan_row else 0) or nicole_min
        nicole_income = nicole_min  # conservative for runway
        interest_rows = conn.execute(
            "SELECT name, current_balance, currency, apy FROM accounts "
            "WHERE is_active = 1 AND type IN ('savings','checking') AND COALESCE(apy, 0) > 0"
        ).fetchall()
        interest_breakdown = []
        interest_income_monthly = 0.0
        for r in interest_rows:
            bal_aud = (r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD')
            monthly = bal_aud * (r['apy'] or 0) / 100.0 / 12.0
            interest_income_monthly += monthly
            interest_breakdown.append({
                'account': r['name'],
                'balance_aud': round(bal_aud, 0),
                'apy_pct': round(r['apy'] or 0, 2),
                'monthly_aud': round(monthly, 2),
            })

        # Staking rewards — ETH (beacon withdrawals) + Solana (stake-account rewards).
        # Additional addresses via env: CRYPTO_STAKING_ADDRESSES (ETH), SOLANA_STAKING_WALLET (SOL).
        staking_income_monthly = 0.0
        staking_breakdown: List[Dict] = []
        try:
            eth_addrs = [a.strip() for a in os.getenv('CRYPTO_STAKING_ADDRESSES', '0x456099f8DE31c594CA40c8D868237e75ECc03d1e').split(',') if a.strip()]
            for addr in eth_addrs:
                r = _fetch_eth_staking(addr)
                mo = (r.get('monthly_aud') or 0)
                if mo > 0:
                    staking_income_monthly += mo
                    staking_breakdown.append({
                        'source': 'ETH staking',
                        'address': addr,
                        'monthly_aud': round(mo, 2),
                        'basis': r.get('basis', '30d'),
                    })
            sol_addrs = [a.strip() for a in os.getenv('SOLANA_STAKING_WALLET', '').split(',') if a.strip()]
            for addr in sol_addrs:
                r = _fetch_solana_staking(addr)
                mo = (r.get('monthly_aud') or 0)
                if mo > 0:
                    staking_income_monthly += mo
                    staking_breakdown.append({
                        'source': 'SOL staking',
                        'address': addr,
                        'monthly_aud': round(mo, 2),
                        'basis': r.get('basis', '30d'),
                    })
        except Exception as e:
            logger.warning(f"Staking fetch failed: {e}")

        baseline_income = txn_income + nicole_income + interest_income_monthly + staking_income_monthly
        baseline_net_burn = baseline_living - baseline_income

        # Full burn: same structured income applied over the longer window.
        full_net_burn = (
            sum(s['living'] for s in series) / max(1, len(series))
            - (nicole_income + interest_income_monthly + staking_income_monthly)
            - txn_income
        )

        # Cash for runway = savings + checking balances only (exclude debt + investments).
        cash_row = conn.execute(
            """SELECT currency, current_balance FROM accounts
               WHERE is_active = 1 AND type IN ('savings','checking')"""
        ).fetchall()
        cash_aud = sum((r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD') for r in cash_row)

        # Runway scenarios.
        def months(burn: float) -> Optional[float]:
            if burn <= 0:
                return None  # surplus
            return round(cash_aud / burn, 1)

        runway = {
            'cash_aud': round(cash_aud, 2),
            'baseline_net_burn_per_month': round(baseline_net_burn, 2),
            'full_avg_net_burn_per_month': round(full_net_burn, 2),
            'runway_months_at_baseline': months(baseline_net_burn),
            'runway_months_at_full_avg': months(full_net_burn),
        }
        # Income opportunity — any active savings/checking balance sitting at 0% APY
        # that could be redeployed into the best available AUD rate.
        best_apy_row = conn.execute(
            "SELECT MAX(apy) AS best FROM accounts WHERE is_active = 1 AND currency = 'AUD' AND type IN ('savings','checking')"
        ).fetchone()
        best_apy = (best_apy_row['best'] or 0) if best_apy_row else 0
        target_apy = max(best_apy, 5.15)          # 5.15% = AU high-yield market baseline
        idle_rows = conn.execute(
            "SELECT id, name, currency, current_balance FROM accounts "
            "WHERE is_active = 1 AND type IN ('savings','checking') AND COALESCE(apy,0) = 0 AND COALESCE(current_balance,0) > 0"
        ).fetchall()
        opportunity_items = []
        opportunity_monthly = 0.0
        for r in idle_rows:
            bal_aud = (r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD')
            monthly_delta = bal_aud * target_apy / 100.0 / 12.0
            if monthly_delta < 1:
                continue
            opportunity_monthly += monthly_delta
            opportunity_items.append({
                'account': r['name'],
                'balance_aud': round(bal_aud, 0),
                'monthly_uplift_aud': round(monthly_delta, 2),
                'target_apy_pct': round(target_apy, 2),
            })

        # Yield efficiency: what % of total cash is earning the best-available
        # AUD rate (conceptually: "how much of your idle money is actually
        # working hard?").  Denominator = total savings+checking balance; numerator
        # = balances whose APY >= 90% of the best available rate.
        yield_efficiency_pct = 0.0
        try:
            if cash_aud > 0 and target_apy > 0:
                threshold = target_apy * 0.9
                efficient_rows = conn.execute(
                    """SELECT currency, current_balance FROM accounts
                       WHERE is_active = 1 AND type IN ('savings','checking')
                         AND COALESCE(apy, 0) >= ?""",
                    (threshold,),
                ).fetchall()
                efficient_aud = sum(
                    (r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD')
                    for r in efficient_rows
                )
                yield_efficiency_pct = round((efficient_aud / cash_aud) * 100, 1)
        except Exception:
            pass

        structured_income = {
            'nicole_monthly': round(nicole_income, 2),
            'nicole_monthly_min': round(nicole_min, 2),
            'nicole_monthly_max': round(nicole_max, 2),
            'interest_monthly': round(interest_income_monthly, 2),
            'staking_monthly': round(locals().get('staking_income_monthly', 0) or 0, 2),
            'staking_breakdown': locals().get('staking_breakdown', []),
            'txn_income_monthly': round(txn_income, 2),
            'total_monthly': round(baseline_income, 2),
            'interest_breakdown': interest_breakdown,
            'opportunity_monthly_aud': round(opportunity_monthly, 2),
            'opportunity_items': opportunity_items,
            'yield_efficiency_pct': yield_efficiency_pct,
            'target_apy_pct': round(target_apy, 2),
        }

        # Biggest controllable living categories (last 3 months).
        cat_rows = conn.execute(
            """SELECT COALESCE(t.category,'Uncategorised') AS category,
                      COALESCE(t.currency,'AUD') AS ccy,
                      -SUM(t.amount) AS amt,
                      COUNT(*) AS n
               FROM transactions t
               WHERE t.amount < 0 AND t.transaction_type != 'transfer'
                 AND t.category != 'Investment' AND t.project_id IS NULL
                 AND t.transaction_date >= date('now', ?)
               GROUP BY category, ccy
               ORDER BY amt DESC""",
            (f'-{living_window} months',),
        ).fetchall()
        by_cat: Dict[str, dict] = {}
        for r in cat_rows:
            rate = fx(r['ccy'].upper(), 'AUD')
            agg = by_cat.setdefault(r['category'], {'category': r['category'], 'amount': 0.0, 'transactions': 0})
            agg['amount'] += (r['amt'] or 0) * rate
            agg['transactions'] += r['n'] or 0
        categories = sorted(
            ({**v, 'amount': round(v['amount'] / living_window, 2)} for v in by_cat.values()),
            key=lambda x: -x['amount'],
        )

    result = {
        'series': series,
        'baseline_income': round(baseline_income, 2),
        'baseline_living': round(baseline_living, 2),
        'runway': runway,
        'structured_income': structured_income,
        'top_categories_last_window': categories[:10],
        'living_window_months': living_window,
    }
    # Iteration 23 perf fix: cache the full result. Future cold-cache reloads
    # within 60s skip the expensive ETH/SOL staking external calls entirely.
    _RUNWAY_CACHE[cache_key] = {'t': now_ts, 'data': result}
    return _with_cache_meta(result, now_ts, now_ts)


@app.get("/api/advisor/leverage-calc")
def api_advisor_leverage_calc(
    loan_amount_aud: float,
    loan_rate_pct: float,
    yield_pct: float,
    franking_pct: float = 0.0,
    marginal_tax_pct: float = 47.0,
):
    """Simulate net annual cashflow from a proposed borrow-to-invest trade.

    Returns pre-tax and after-tax net cashflow per year. Positive = pays for
    itself. Reuses the existing `baseline_net_burn` runway figure to show the
    impact on runway as well.
    """
    if loan_amount_aud <= 0:
        raise HTTPException(status_code=400, detail="loan_amount_aud must be positive")

    interest_cost = loan_amount_aud * (loan_rate_pct / 100)
    gross_yield = loan_amount_aud * (yield_pct / 100)
    franking_credit = gross_yield * (franking_pct / 100)  # imputation credit (AU)

    pretax_cashflow = gross_yield - interest_cost

    # After-tax: interest is deductible against yield; franking credit offsets tax.
    taxable = gross_yield - interest_cost + franking_credit  # gross-up
    tax = taxable * (marginal_tax_pct / 100) if taxable > 0 else taxable * (marginal_tax_pct / 100)  # refund if negative
    net_cashflow = gross_yield - interest_cost + franking_credit - tax

    return {
        'inputs': {
            'loan_amount_aud': loan_amount_aud,
            'loan_rate_pct': loan_rate_pct,
            'yield_pct': yield_pct,
            'franking_pct': franking_pct,
            'marginal_tax_pct': marginal_tax_pct,
        },
        'annual': {
            'interest_cost': round(interest_cost, 2),
            'gross_yield': round(gross_yield, 2),
            'franking_credit': round(franking_credit, 2),
            'pretax_cashflow': round(pretax_cashflow, 2),
            'tax_due': round(tax, 2),
            'net_cashflow_after_tax': round(net_cashflow, 2),
        },
        'monthly': {
            'interest_cost': round(interest_cost / 12, 2),
            'gross_yield': round(gross_yield / 12, 2),
            'pretax_cashflow': round(pretax_cashflow / 12, 2),
            'net_cashflow_after_tax': round(net_cashflow / 12, 2),
        },
        'verdict': _leverage_verdict(pretax_cashflow, net_cashflow),
    }


def _leverage_verdict(pretax: float, after_tax: float) -> str:
    if pretax >= 0 and after_tax >= 0:
        return 'Cashflow positive on both pre-tax and after-tax basis — genuinely self-funding.'
    if pretax < 0 <= after_tax:
        return ('Pre-tax negative but after-tax positive — depends on receiving the full franking refund, '
                'and you still need the cash to cover interest month-to-month.')
    if after_tax < 0 and pretax < 0:
        return 'Cashflow NEGATIVE — would add to your burn rate. Do not proceed unless capital gains > shortfall.'
    return 'Marginal — re-check inputs; small changes flip the sign.'


@app.get("/api/projects")
def api_projects_list():
    with get_db_connection() as conn:
        rows = conn.execute(
            """SELECT p.*,
                      (SELECT COUNT(*) FROM transactions t WHERE t.project_id = p.id) AS transaction_count,
                      (SELECT COALESCE(-SUM(t.amount),0) FROM transactions t
                       WHERE t.project_id = p.id AND t.amount < 0) AS total_spend
               FROM projects p ORDER BY p.started_at DESC NULLS LAST, p.id DESC"""
        ).fetchall()
    return [dict(r) for r in rows]


class ProjectIn(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    property_address: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    sale_price: Optional[float] = None
    notes: Optional[str] = None


@app.post("/api/projects")
def api_projects_create(payload: ProjectIn):
    if not payload.name:
        raise HTTPException(status_code=400, detail="name is required")
    with get_db_connection() as conn:
        cur = conn.execute(
            """INSERT INTO projects (name, kind, property_address, started_at, completed_at, sale_price, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (payload.name, payload.kind or 'renovation', payload.property_address,
             payload.started_at, payload.completed_at, payload.sale_price, payload.notes),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id=?", (cur.lastrowid,)).fetchone()
        return dict(row)


@app.put("/api/projects/{project_id}")
def api_projects_update(project_id: int, payload: ProjectIn):
    fields = {k: v for k, v in payload.dict().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_db_connection() as conn:
        cur = conn.execute(f"UPDATE projects SET {set_clause} WHERE id = ?", (*fields.values(), project_id))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Project not found")
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        return dict(row)


@app.delete("/api/projects/{project_id}")
def api_projects_delete(project_id: int):
    with get_db_connection() as conn:
        # Null out the FK on transactions first (schema uses ON DELETE SET NULL, but do it explicitly).
        conn.execute("UPDATE transactions SET project_id = NULL WHERE project_id = ?", (project_id,))
        cur = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Project not found")
        conn.commit()
    return {"deleted": project_id}


class TagTxnIn(BaseModel):
    transaction_ids: List[int]
    project_id: Optional[int]


@app.post("/api/transactions/tag-project")
def api_transactions_tag_project(payload: TagTxnIn):
    """Tag (or untag with project_id=None) a batch of transactions."""
    if not payload.transaction_ids:
        raise HTTPException(status_code=400, detail="transaction_ids required")
    with get_db_connection() as conn:
        placeholders = ",".join("?" * len(payload.transaction_ids))
        conn.execute(
            f"UPDATE transactions SET project_id = ? WHERE id IN ({placeholders})",
            (payload.project_id, *payload.transaction_ids),
        )
        conn.commit()
    return {"updated": len(payload.transaction_ids), "project_id": payload.project_id}


# Circuit-breaker config — per-call timeout + cross-call failure tracking.
# Context: uvicorn's single-worker + async-threadpool model means ONE slow Kimi
# call can block ~40 sibling request-threadpool slots. Repeated hangs during
# the autonomous session caused 3 force-restarts. The fix:
#   1. Hard timeout per Kimi HTTP call (KIMI_TIMEOUT_SEC, default 45s)
#   2. Cross-call breaker — after N consecutive timeouts/errors, short-circuit
#      for BREAKER_COOLDOWN_SEC so we stop stacking hung threads while the
#      upstream recovers.  Callers still get `None` back, triggering their
#      deterministic fallback copy.
# 75s gives Kimi K2.6 room to finish its chain-of-thought reasoning (typical
# 30-60s end-to-end) while still hard-stopping before the threadpool-starvation
# window. Earlier attempts at 45s were tripping on normal-case calls.
_KIMI_TIMEOUT_SEC = float(os.getenv('KIMI_TIMEOUT_SEC', '75'))
_KIMI_BREAKER_THRESHOLD = int(os.getenv('KIMI_BREAKER_THRESHOLD', '3'))
_KIMI_BREAKER_COOLDOWN_SEC = float(os.getenv('KIMI_BREAKER_COOLDOWN_SEC', '90'))
_KIMI_BREAKER_STATE: Dict[str, float] = {'consecutive_failures': 0.0, 'open_until': 0.0}


def _kimi_chat(
    system: str,
    user: str,
    *,
    max_tokens: int = 6000,
    temperature: float = 0.3,
    response_format: Optional[dict] = None,
    timeout: Optional[float] = None,
) -> Optional[str]:
    """Central Kimi K2.6 helper. Returns the assistant message text, or None on
    failure / timeout / circuit-open.

    K2.6 uses chain-of-thought internally — reasoning tokens eat the max_tokens
    budget *before* any assistant content is emitted. Defaulting to 6000 gives
    headroom for ~3-4k of reasoning + 1-2k response.

    Wrapped in a circuit-breaker: per-call timeout (KIMI_TIMEOUT_SEC env,
    default 45s) + short-circuit after 3 consecutive failures for 90s. This
    prevents the threadpool-starvation pattern that caused repeated uvicorn
    hangs during autonomous sessions.

    Env vars:
      KIMI_API_KEY                  (falls back to OPENAI_API_KEY for local testing)
      KIMI_BASE_URL                 (default: https://api.moonshot.ai/v1)
      KIMI_MODEL                    (default: kimi-k2.6)
      KIMI_TIMEOUT_SEC              (default: 45)
      KIMI_BREAKER_THRESHOLD        (default: 3 — open after 3 consec fails)
      KIMI_BREAKER_COOLDOWN_SEC     (default: 90 — short-circuit for this long)
    """
    import time as _time
    api_key = os.getenv('KIMI_API_KEY') or os.getenv('OPENAI_API_KEY')
    if not api_key:
        return None

    # Circuit open? Short-circuit immediately — caller gets fallback path.
    now = _time.time()
    if _KIMI_BREAKER_STATE['open_until'] > now:
        remaining = _KIMI_BREAKER_STATE['open_until'] - now
        logger.info(f"Kimi breaker OPEN — {remaining:.0f}s left; returning None")
        return None

    try:
        from openai import OpenAI
    except ImportError:
        return None

    effective_timeout = timeout if timeout is not None else _KIMI_TIMEOUT_SEC
    try:
        client = OpenAI(
            api_key=api_key,
            base_url=os.getenv('KIMI_BASE_URL', 'https://api.moonshot.ai/v1'),
            timeout=effective_timeout,    # httpx timeout at client level
        )
        kwargs = dict(
            model=os.getenv('KIMI_MODEL', 'kimi-k2.6'),
            messages=[{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=effective_timeout,    # per-request override too
        )
        if response_format is not None:
            kwargs['response_format'] = response_format
        started = _time.time()
        resp = client.chat.completions.create(**kwargs)
        elapsed = _time.time() - started
        if elapsed > effective_timeout * 0.9:
            logger.info(f"Kimi chat slow: {elapsed:.1f}s (timeout {effective_timeout:.0f}s)")
        # Success — reset failure counter.
        _KIMI_BREAKER_STATE['consecutive_failures'] = 0
        return (resp.choices[0].message.content or '').strip()
    except Exception as e:
        _KIMI_BREAKER_STATE['consecutive_failures'] += 1
        failures = int(_KIMI_BREAKER_STATE['consecutive_failures'])
        if failures >= _KIMI_BREAKER_THRESHOLD:
            _KIMI_BREAKER_STATE['open_until'] = now + _KIMI_BREAKER_COOLDOWN_SEC
            logger.warning(
                f"Kimi breaker OPENING after {failures} consecutive failures — "
                f"cooling down {_KIMI_BREAKER_COOLDOWN_SEC:.0f}s. Last error: {e}"
            )
        else:
            logger.warning(f"Kimi chat call failed ({failures}/{_KIMI_BREAKER_THRESHOLD}): {e}")
        return None


@app.get("/api/intel/kimi-breaker-status")
def api_kimi_breaker_status():
    """Observability into the Kimi circuit-breaker state. Useful for the
    admin UI / debug when Kimi-driven narratives silently fall back."""
    import time as _time
    now = _time.time()
    open_until = _KIMI_BREAKER_STATE['open_until']
    return {
        'consecutive_failures': int(_KIMI_BREAKER_STATE['consecutive_failures']),
        'is_open': open_until > now,
        'cooldown_remaining_sec': max(0, round(open_until - now, 1)),
        'threshold': _KIMI_BREAKER_THRESHOLD,
        'cooldown_sec': _KIMI_BREAKER_COOLDOWN_SEC,
        'timeout_sec': _KIMI_TIMEOUT_SEC,
    }


@app.get("/api/advisor/narrative")
def api_advisor_narrative(
    provider: Optional[str] = None,
    force: bool = False,
    cache_only: bool = False,
):
    """Generate a one-paragraph LLM narrative of the user's wealth situation,
    grounded in the rule-based recommendations. Cached for 6 hours per net-worth
    bucket so refreshing the page is free.

    `provider`: 'kimi' (default — cheaper), 'gemini' (fallback), or 'auto' (kimi first, fall back)
    `cache_only=True` (Iteration 22): return exact-key cached entry if any
    (fresh or stale, fall back to most-recent of any key), else `{cached: false}`.
    No Kimi fired on cache miss.
    """
    from advisor_engine import build_recommendations
    _, fx = _fx_cache()
    nw = _net_worth_breakdown_aud()
    with get_db_connection() as conn:
        recs = build_recommendations(conn, fx, nw['net_worth_aud'])

    provider = (provider or 'auto').lower()
    cache_key = f"{provider}|{int(recs['wealth_health_score'])}|{int(nw['net_worth_aud']/1000)}"
    cached = _advisor_narrative_cache.get(cache_key)
    fresh_threshold = 6 * 3600
    if cached and not force:
        age = (datetime.utcnow() - datetime.fromisoformat(cached['_cached_at'])).total_seconds()
        if age < fresh_threshold:
            return cached
    if cache_only:
        # Prefer exact-key (most relevant to current state).
        if cached:
            return {**cached, '_stale': True}
        # Else fall back to most-recent cached narrative across all keys, so the
        # user still sees *something* on first mount.
        if _advisor_narrative_cache:
            most_recent = max(
                _advisor_narrative_cache.values(),
                key=lambda c: c.get('_cached_at') or '',
            )
            return {**most_recent, '_stale': True}
        return {'cached': False}

    rec_summary = '\n'.join(
        f"- [{r['severity']}] {r['kind']}: {r['title']} — {r['detail']}"
        for r in recs['recommendations'][:12]
    ) or '(no recommendations triggered)'
    # Pull structured income so the narrative can LEAD with it — income is the survival anchor.
    structured = {}
    try:
        with get_db_connection() as conn:
            pr = conn.execute(
                "SELECT nicole_income_monthly, nicole_income_monthly_min, nicole_income_monthly_max FROM wealth_plan WHERE id = 1"
            ).fetchone()
        nicole = (pr['nicole_income_monthly_min'] if pr else 0) or (pr['nicole_income_monthly'] if pr else 0) or 0
        # Rough interest estimate from holdings table via a quick scan
        with get_db_connection() as conn:
            apy_rows = conn.execute(
                "SELECT current_balance, currency, apy FROM accounts WHERE is_active=1 AND type IN ('savings','checking') AND COALESCE(apy,0) > 0"
            ).fetchall()
        interest_monthly = sum(((r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD')) * (r['apy'] or 0) / 100.0 / 12.0 for r in apy_rows)
        # Crypto staking (ETH + SOL) — same source of truth as the runway endpoint
        staking_monthly = 0.0
        staking_bits: List[str] = []
        try:
            for a in [x.strip() for x in os.getenv('CRYPTO_STAKING_ADDRESSES', '0x456099f8DE31c594CA40c8D868237e75ECc03d1e').split(',') if x.strip()]:
                r = _fetch_eth_staking(a)
                if (r.get('monthly_aud') or 0) > 0:
                    staking_monthly += r['monthly_aud']
                    staking_bits.append(f"ETH {a[:8]}… ${r['monthly_aud']:,.0f}/mo")
            for a in [x.strip() for x in os.getenv('SOLANA_STAKING_WALLET', '').split(',') if x.strip()]:
                r = _fetch_solana_staking(a)
                if (r.get('monthly_aud') or 0) > 0:
                    staking_monthly += r['monthly_aud']
                    staking_bits.append(f"SOL {a[:8]}… ${r['monthly_aud']:,.0f}/mo")
        except Exception:
            pass
        structured = {
            'nicole_min': nicole,
            'interest_monthly': interest_monthly,
            'staking_monthly': staking_monthly,
            'staking_detail': ' + '.join(staking_bits) if staking_bits else '',
            'total': nicole + interest_monthly + staking_monthly,
        }
    except Exception:
        pass

    system = (
        "You are a holistic personal-finance advisor for Christopher & Nicole Howell in Australia. "
        "They are in DRAWDOWN mode (not working). Plan: Acacia reno → sell → Lind build → sell 2028 → retire Tasmania 2030. "
        "Be direct, no hedging, no disclaimers, no 'consult a professional'. Plain English. "
        "LEAD WITH INCOME as the survival anchor — how Nicole's salary + interest income + crypto staking rewards position them against spend. "
        "Synthesise, don't repeat KPI numbers verbatim."
    )
    user_prompt = (
        f"INCOME ANCHOR (AUD/mo — the first thing to frame):\n"
        f"  Nicole's salary (casual, conservative): ${structured.get('nicole_min', 0):,.0f}\n"
        f"  Savings-account interest: ${structured.get('interest_monthly', 0):,.0f}\n"
        f"  Crypto staking rewards: ${structured.get('staking_monthly', 0):,.0f}"
        f"{(' (' + structured['staking_detail'] + ')') if structured.get('staking_detail') else ''}\n"
        f"  Total monthly income: ${structured.get('total', 0):,.0f}\n\n"
        f"POSITION (AUD):\n"
        f"  net worth: ${recs['kpis']['net_worth_aud']:,.0f}\n"
        f"  cash: ${recs['kpis']['cash_aud']:,.0f}\n"
        f"  debt: ${recs['kpis']['debt_aud']:,.0f}\n"
        f"  monthly expenses (90d avg): ${recs['kpis']['monthly_expenses_avg_aud']:,.0f}\n"
        f"  runway in cash: {recs['kpis']['runway_months']} months\n\n"
        f"Top rule-based recommendations:\n{rec_summary}\n\n"
        "Write ONE paragraph (max 130 words). First sentence must describe how the income covers (or doesn't cover) their monthly spend. "
        "Then the 2-3 highest-leverage moves for this quarter, ranked by $ impact."
    )

    narrative: Optional[str] = None
    used_provider: Optional[str] = None

    # Try Kimi first (cheaper) unless provider explicitly = 'gemini'
    if provider in ('kimi', 'auto'):
        narrative = _kimi_chat(system, user_prompt, max_tokens=6000, temperature=0.4)
        if narrative:
            used_provider = 'kimi'

    if not narrative and provider in ('gemini', 'auto'):
        gem_key = os.getenv('GEMINI_API_KEY')
        if gem_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=gem_key)
                model = genai.GenerativeModel('gemini-2.5-flash')
                resp = model.generate_content(system + '\n\n' + user_prompt)
                narrative = (resp.text or '').strip()
                used_provider = 'gemini'
            except Exception as e:
                logger.warning(f"Gemini narrative failed: {e}")

    if not narrative:
        return {
            'narrative': None,
            'reason': 'No LLM provider available (check KIMI_API_KEY or GEMINI_API_KEY)',
            '_cached_at': datetime.utcnow().isoformat(),
        }

    result = {
        'narrative': narrative,
        'provider': used_provider,
        'wealth_health_score': recs['wealth_health_score'],
        '_cached_at': datetime.utcnow().isoformat(),
    }
    _advisor_narrative_cache[cache_key] = result
    return result


@app.get("/api/intelligence/signals")
def get_portfolio_signals():
    """Get investment signals based on portfolio and market data"""
    try:
        from intelligence_engine import IntelligenceEngine
        from wealthguard_data_sync import DatabaseManager

        db = DatabaseManager(DB_PATH)
        holdings = db.get_all_holdings()

        engine = IntelligenceEngine()
        signals = engine.generate_portfolio_signals(holdings)

        return {
            "signals": signals,
            "generated_at": datetime.now().isoformat(),
            "count": len(signals),
            "holdings_analyzed": len(holdings),
        }
    except Exception as e:
        logger.exception("Signals error")
        return {"signals": [], "error": str(e)}

@app.get("/api/intelligence/sentiment/{ticker}")
def get_ticker_sentiment(ticker: str):
    """Get sentiment analysis for specific ticker"""
    try:
        from intelligence_engine import SwarmDataAggregator
        swarm = SwarmDataAggregator()
        
        sentiment = swarm.get_stocktwits_sentiment(ticker.upper())
        fear_greed = swarm.get_fear_greed_index()
        
        return {
            "ticker": ticker.upper(),
            "sentiment": sentiment,
            "market_sentiment": fear_greed
        }
    except Exception as e:
        logger.error(f"Sentiment error: {e}")
        return {"error": str(e)}


@app.get("/api/markets/indices/{region}")
def get_market_indices(region: str):
    """Get major market indices for a region (US, AU, CN)"""
    region = region.upper()
    
    # Define index symbols for each region
    index_map = {
        "US": [
            {"symbol": "^GSPC", "name": "S&P 500", "display_symbol": "SPX"},
            {"symbol": "^DJI", "name": "Dow Jones", "display_symbol": "DJI"},
            {"symbol": "^IXIC", "name": "NASDAQ", "display_symbol": "IXIC"},
            {"symbol": "^RUT", "name": "Russell 2000", "display_symbol": "RUT"},
            {"symbol": "^VIX", "name": "VIX", "display_symbol": "VIX"},
        ],
        "AU": [
            {"symbol": "^AXJO", "name": "ASX 200", "display_symbol": "XJO"},
            {"symbol": "^AXKO", "name": "ASX 300", "display_symbol": "XKO"},
            {"symbol": "^AORD", "name": "All Ordinaries", "display_symbol": "XAO"},
        ],
        "CN": [
            {"symbol": "000001.SS", "name": "SSE Composite", "display_symbol": "SH000001"},
            {"symbol": "399001.SZ", "name": "SZSE Component", "display_symbol": "SZ399001"},
            {"symbol": "399006.SZ", "name": "ChiNext Index", "display_symbol": "SZ399006"},
            {"symbol": "000300.SS", "name": "CSI 300", "display_symbol": "SH000300"},
        ],
    }
    
    if region not in index_map:
        raise HTTPException(status_code=400, detail="Invalid region. Use US, AU, or CN")
    
    indices = index_map[region]
    results = []
    
    for idx in indices:
        try:
            # Try to fetch live data from Yahoo Finance
            import urllib.request
            import json
            
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{idx['symbol']}?interval=1d&range=2d"
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode())
                
                result = data.get('chart', {}).get('result', [{}])[0]
                if not result:
                    continue
                
                meta = result['meta']
                price = meta.get('regularMarketPrice')
                prev_close = meta.get('previousClose') or meta.get('chartPreviousClose')
                
                if price and prev_close:
                    change = price - prev_close
                    change_percent = (change / prev_close) * 100
                    
                    results.append({
                        "symbol": idx['display_symbol'],
                        "name": idx['name'],
                        "price": round(price, 2),
                        "change": round(change, 2),
                        "change_percent": round(change_percent, 2),
                        "source": "live"
                    })
        except Exception as e:
            logger.warning(f"Failed to fetch index {idx['symbol']}: {e}")
            continue
    
    return {
        "region": region,
        "indices": results,
        "updated_at": datetime.now().isoformat(),
        "count": len(results)
    }


# ==================== PodBits API Routes ====================

from podbits_module import (
    PodcastSource, PodcastEpisode, PodcastTag, EpisodeSearchResult,
    create_source, get_source, get_all_sources, update_source, delete_source,
    create_episode, get_episode, get_episodes_by_source, get_all_episodes,
    update_episode, delete_episode,
    create_tag, get_all_tags, add_tag_to_episode, remove_tag_from_episode,
    search_episodes, search_by_keyword, seed_default_sources
)

class EpisodeEngagementIn(BaseModel):
    is_listened: Optional[bool] = None
    user_rating: Optional[int] = None
    user_notes: Optional[str] = None


@app.post("/api/podbits/episodes/{episode_id}/engagement")
def api_episode_engagement(episode_id: int, payload: EpisodeEngagementIn):
    """Partial update of listening state / rating / notes."""
    sets: List[str] = []
    params: List = []
    if payload.is_listened is not None:
        sets.append("is_listened = ?")
        params.append(1 if payload.is_listened else 0)
        if payload.is_listened:
            sets.append("listened_at = datetime('now')")
    if payload.user_rating is not None:
        rating = max(0, min(5, int(payload.user_rating)))
        sets.append("user_rating = ?")
        params.append(rating)
    if payload.user_notes is not None:
        sets.append("user_notes = ?")
        params.append(payload.user_notes)
    if not sets:
        raise HTTPException(status_code=400, detail="Nothing to update")
    params.append(episode_id)
    with get_db_connection() as conn:
        cur = conn.execute(
            f"UPDATE podbits_episodes SET {', '.join(sets)} WHERE id = ?",
            tuple(params),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Episode not found")
        conn.commit()
        row = conn.execute(
            "SELECT id, title, is_listened, listened_at, user_rating, user_notes FROM podbits_episodes WHERE id = ?",
            (episode_id,),
        ).fetchone()
    return dict(row)


@app.post("/api/podbits/episodes/{episode_id}/analyze")
def api_analyze_episode(episode_id: int, force: bool = False):
    """Run the AI analyst pass on this episode — returns {episode_take, pod_takes[]}."""
    try:
        from podbits_ai_analyst import analyze_episode
        out = analyze_episode(episode_id, force=force)
        if not out:
            raise HTTPException(
                status_code=502,
                detail="No analyst output — every LLM provider failed or no summary was available.",
            )
        return out
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Analyst error")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/podbits/analyze/batch")
def api_analyze_batch(limit: int = 20, force: bool = False):
    try:
        from podbits_ai_analyst import analyze_batch
        results = analyze_batch(limit=max(1, min(limit, 100)), force=force)
        ok = sum(1 for r in results if r['ok'])
        return {"processed": len(results), "ok": ok, "results": results}
    except Exception as e:
        logger.exception("Analyst batch error")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/podbits/narratives")
def api_podbits_narratives(
    limit: int = 50,
    source_id: Optional[int] = None,
    person: Optional[str] = None,
    ticker: Optional[str] = None,
    sentiment: Optional[str] = None,
    only_mine: bool = False,
):
    """Flattened 'expert takes' feed — one row per key_point / quote / action_item."""
    try:
        from podbits_narratives import list_narratives
        rows = list_narratives(
            limit=max(1, min(limit, 500)),
            source_id=source_id,
            person=person,
            ticker=ticker,
            sentiment=sentiment,
            only_mine=bool(only_mine),
        )
        return {"count": len(rows), "items": rows}
    except Exception as e:
        logger.exception("Narratives error")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/podbits/facets")
def api_podbits_facets():
    """People + tickers + sources for building filter chips."""
    try:
        from podbits_narratives import list_facets
        return list_facets()
    except Exception as e:
        logger.exception("Facets error")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/podbits/status")
def podbits_status():
    """Get PodBits system status"""
    try:
        conn = get_db_connection()
        stats = conn.execute("""
            SELECT 
                (SELECT COUNT(*) FROM podbits_sources) as source_count,
                (SELECT COUNT(*) FROM podbits_episodes) as episode_count,
                (SELECT COUNT(*) FROM podbits_tags) as tag_count
        """).fetchone()
        conn.close()
        
        return {
            "status": "active",
            "sources": stats['source_count'],
            "episodes": stats['episode_count'],
            "tags": stats['tag_count']
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}

# Source CRUD
@app.post("/api/podbits/sources")
def api_create_source(source: PodcastSource):
    """Create a new podcast/YouTube source"""
    try:
        result = create_source(source)
        return {"success": True, "source": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/podbits/sources")
def api_get_sources(active_only: bool = False):
    """Get all sources"""
    try:
        sources = get_all_sources(active_only)
        return {"sources": sources}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/podbits/sources/{source_id}")
def api_get_source(source_id: int):
    """Get a specific source"""
    source = get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    return {"source": source}

@app.put("/api/podbits/sources/{source_id}")
def api_update_source(source_id: int, source: PodcastSource):
    """Update a source"""
    try:
        update_source(source_id, source)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/podbits/sources/{source_id}")
def api_delete_source(source_id: int):
    """Delete a source"""
    try:
        delete_source(source_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Episode CRUD
@app.post("/api/podbits/episodes")
def api_create_episode(episode: PodcastEpisode):
    """Create a new episode"""
    try:
        result = create_episode(episode)
        return {"success": True, "episode": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/podbits/episodes")
def api_get_episodes(limit: int = 50, offset: int = 0, tag: str = None, source_id: int = None):
    """Get episodes with optional filters"""
    try:
        if source_id:
            episodes = get_episodes_by_source(source_id, limit)
        else:
            episodes = get_all_episodes(limit, offset, tag)
        return {"episodes": episodes}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/podbits/episodes/{episode_id}")
def api_get_episode(episode_id: int):
    """Get a specific episode"""
    episode = get_episode(episode_id)
    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")
    return {"episode": episode}

@app.put("/api/podbits/episodes/{episode_id}")
def api_update_episode(episode_id: int, episode: PodcastEpisode):
    """Update an episode"""
    try:
        update_episode(episode_id, episode)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/podbits/episodes/{episode_id}")
def api_delete_episode(episode_id: int):
    """Delete an episode"""
    try:
        delete_episode(episode_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Tags
@app.get("/api/podbits/tags")
def api_get_tags():
    """Get all tags with episode counts"""
    try:
        tags = get_all_tags()
        return {"tags": tags}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/podbits/tags")
def api_create_tag(tag: PodcastTag):
    """Create a new tag"""
    try:
        result = create_tag(tag)
        return {"success": True, "tag": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/podbits/episodes/{episode_id}/tags/{tag_id}")
def api_add_tag_to_episode(episode_id: int, tag_id: int):
    """Add a tag to an episode"""
    try:
        add_tag_to_episode(episode_id, tag_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/podbits/episodes/{episode_id}/tags/{tag_id}")
def api_remove_tag_from_episode(episode_id: int, tag_id: int):
    """Remove a tag from an episode"""
    try:
        remove_tag_from_episode(episode_id, tag_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Search
@app.get("/api/podbits/search")
def api_search_episodes(q: str, limit: int = 20):
    """Search episodes by keyword/phrase"""
    try:
        # Try FTS5 first, fallback to LIKE search
        try:
            results = search_episodes(q, limit)
        except:
            # Fallback to simple keyword search
            episodes = search_by_keyword(q, limit)
            results = [{
                "episode_id": ep.id,
                "title": ep.title,
                "summary": ep.summary,
                "source_name": ep.source_name,
                "published_at": ep.published_at,
                "tags": ep.tags,
                "relevance_score": 1.0
            } for ep in episodes]
        
        return {"results": results, "query": q}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/podbits/seed")
def api_seed_sources():
    """Seed default podcast sources"""
    try:
        seed_default_sources()
        return {"success": True, "message": "Default sources seeded"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/podbits/ingest/{source_id}")
def api_ingest_source(source_id: int, max_episodes: int = 5):
    """Ingest episodes from a specific source"""
    try:
        from podbits_ingest import process_source
        result = process_source(source_id, max_episodes=max_episodes)
        if isinstance(result, dict) and "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Ingest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/podbits/ingest")
def api_ingest_all(max_per_source: int = 5):
    """Ingest episodes from all active sources"""
    try:
        from podbits_ingest import process_all_sources
        results = process_all_sources(max_per_source=max_per_source)
        return {"results": results}
    except Exception as e:
        logger.error(f"Bulk ingest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# AI Summarization endpoints
def _llm_keys_present() -> bool:
    return any(os.getenv(k) for k in ('QWEN_API_KEY', 'GEMINI_API_KEY', 'KIMI_API_KEY', 'OPENAI_API_KEY'))


@app.post("/api/podbits/episodes/{episode_id}/summarize")
def api_summarize_episode(episode_id: int):
    """Generate a summary — real LLM when keys are set, else fallback extraction."""
    if _llm_keys_present():
        try:
            from podbits_real_ai import regenerate_episode_summary
            result = regenerate_episode_summary(episode_id, force=True)
            if result:
                return {**result, "source": "llm"}
            logger.info("Real-AI returned None; falling back to extractive summarizer")
        except Exception as e:
            logger.warning(f"Real-AI summarizer failed, falling back: {e}")
    try:
        from podbits_ai import summarize_episode
        result = summarize_episode(episode_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Episode not found")
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return {**result, "source": "fallback"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Summarization error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/podbits/summarize/batch")
def api_batch_summarize(limit: int = 10):
    """Batch summarize unprocessed episodes"""
    try:
        from podbits_ai import batch_summarize
        results = batch_summarize(limit=limit)
        return {
            "summarized": len(results),
            "episodes": results
        }
    except Exception as e:
        logger.error(f"Batch summarization error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/podbits/episodes/{episode_id}/summary")
def api_get_episode_summary(episode_id: int):
    """Get structured AI summary for an episode"""
    try:
        from podbits_ai import get_episode_summary
        summary = get_episode_summary(episode_id)
        if summary is None:
            raise HTTPException(status_code=404, detail="Summary not found")
        return {"episode_id": episode_id, "summary": summary}
    except Exception as e:
        logger.error(f"Get summary error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Price Alerts Endpoints
@app.get("/api/alerts")
def get_alerts(hours: int = 24):
    """Get recent price alerts"""
    try:
        from wealthguard_alerts import AlertManager
        manager = AlertManager()
        alerts = manager.get_recent_alerts(hours)
        return {"alerts": alerts, "count": len(alerts)}
    except Exception as e:
        logger.error(f"Error getting alerts: {e}")
        return {"alerts": [], "error": str(e)}


@app.post("/api/alerts/check")
def trigger_alert_check():
    """Manually trigger alert check"""
    try:
        from wealthguard_alerts import AlertManager
        manager = AlertManager()
        result = manager.run_alert_check()
        return result
    except Exception as e:
        logger.error(f"Error running alert check: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/alerts/test")
def send_test_alert():
    """Send a test alert"""
    try:
        from wealthguard_alerts import AlertManager, PriceAlert
        import random
        
        manager = AlertManager()
        manager.ensure_tables()
        
        # Create random test alert
        symbols = ['BTC', 'ETH', 'AAPL', 'TSLA', 'PORTFOLIO']
        directions = [1, -1]
        
        test_alert = PriceAlert(
            symbol=random.choice(symbols),
            alert_type='test',
            current_price=random.randint(50, 50000),
            previous_price=random.randint(50, 50000),
            change_percent=random.choice(directions) * random.uniform(5, 20),
            message='Test alert from WealthGuard Dashboard',
            severity='info'
        )
        
        manager.save_alert(test_alert)
        success = manager.send_telegram_alert(test_alert)
        
        return {
            "sent": success,
            "alert": {
                "symbol": test_alert.symbol,
                "message": test_alert.message,
                "change_percent": round(test_alert.change_percent, 2)
            }
        }
    except Exception as e:
        logger.error(f"Error sending test alert: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Price Sync Status Endpoints
@app.get("/api/sync/status")
def get_sync_status():
    """Get the most recent price sync status"""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # Check if sync_runs table exists
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='sync_runs'
        """)
        if not cursor.fetchone():
            return {
                "status": "unknown",
                "message": "No sync runs recorded yet"
            }
        
        cursor.execute("""
            SELECT * FROM sync_runs
            ORDER BY started_at DESC
            LIMIT 1
        """)
        row = cursor.fetchone()
        
        if not row:
            return {
                "status": "unknown", 
                "message": "No sync runs recorded"
            }
        
        result = dict(row)
        if result.get('details'):
            try:
                result['details'] = json.loads(result['details'])
            except:
                pass
        
        return result


@app.get("/api/sync/history")
def get_sync_history(limit: int = 10):
    """Get price sync run history"""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM sync_runs
            ORDER BY started_at DESC
            LIMIT ?
        """, (limit,))
        rows = cursor.fetchall()
        results = []
        for row in rows:
            result = dict(row)
            if result.get('details'):
                try:
                    result['details'] = json.loads(result['details'])
                except:
                    pass
            results.append(result)
        return results


@app.post("/api/sync/trigger")
def trigger_sync():
    """Trigger a manual price sync"""
    import subprocess
    import sys as _sys
    try:
        result = subprocess.run(
            [_sys.executable, _SYNC_SCRIPT],
            capture_output=True,
            text=True,
            timeout=120,
            env={**os.environ, 'DATABASE_PATH': DB_PATH},
        )
        return {
            "status": "completed" if result.returncode == 0 else "failed",
            "return_code": result.returncode,
            "output": result.stdout[-1000:] if result.stdout else "",
            "error": result.stderr[-500:] if result.stderr else ""
        }
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "message": "Sync took too long"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv('API_PORT', 8000))
    host = os.getenv('API_HOST', '0.0.0.0')
    uvicorn.run(app, host=host, port=port)
