#!/usr/bin/env python3
"""
WealthGuard Live Data Sync Service
Fetches real-time prices from multiple sources and updates SQLite database
"""

import os
import json
import sqlite3
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from pathlib import Path

import aiohttp
import aiofiles
from dotenv import load_dotenv

# Load environment variables
load_dotenv(Path(__file__).parent / '.env')

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('wealthguard-sync')

DB_PATH = os.getenv('DATABASE_PATH', '/root/.openclaw/workspace/wealthguard.db')

# API Configuration
JINA_API_KEY = os.getenv('JINA_API_KEY', '')
ALPHA_VANTAGE_KEY = os.getenv('ALPHA_VANTAGE_API_KEY', '')
FINNHUB_KEY = os.getenv('FINNHUB_API_KEY', '')
COINGECKO_KEY = os.getenv('COINGECKO_API_KEY', '')
NEWSAPI_KEY = os.getenv('NEWSAPI_KEY', '')


@dataclass
class PriceData:
    symbol: str
    price: float
    currency: str
    change_24h: Optional[float] = None
    change_percent_24h: Optional[float] = None
    volume_24h: Optional[float] = None
    market_cap: Optional[float] = None
    last_updated: Optional[str] = None
    source: str = 'unknown'


class DatabaseManager:
    """Manages SQLite database operations"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
    
    def get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    def get_all_holdings(self) -> List[Dict]:
        """Get all holdings that need price updates (excluding vehicles and real estate)"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT h.*, a.currency as account_currency
                FROM holdings h
                JOIN accounts a ON h.account_id = a.id
                WHERE h.shares > 0
                AND h.symbol NOT LIKE 'VEHICLE_%'
                AND h.symbol NOT LIKE 'REAL_ESTATE_%'
                AND h.symbol NOT LIKE 'CASH_%'
            """)
            return [dict(row) for row in cursor.fetchall()]
    
    def update_holding_price(self, symbol: str, price_data: PriceData):
        """Update price for a holding"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE holdings 
                SET current_price = ?,
                    last_price_update = ?
                WHERE symbol = ?
            """, (
                price_data.price,
                price_data.last_updated or datetime.now().isoformat(),
                symbol
            ))
            conn.commit()
            logger.debug(f"Updated {symbol}: ${price_data.price:.2f}")
    
    def get_holding_price(self, symbol: str) -> Optional[Dict]:
        """Get current price info for a holding"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT symbol, current_price, cost_basis_per_share, last_price_update
                FROM holdings WHERE symbol = ?
            """, (symbol,))
            row = cursor.fetchone()
            if row:
                return {
                    'symbol': row[0],
                    'current_price': row[1],
                    'cost_basis_per_share': row[2],
                    'last_price_update': row[3]
                }
            return None
    
    def update_fx_rate(self, from_currency: str, to_currency: str, rate: float, source: str = 'api'):
        """Update FX rate"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO fx_rates (from_currency, to_currency, rate, recorded_at, source)
                VALUES (?, ?, ?, ?, ?)
            """, (from_currency, to_currency, rate, datetime.now().isoformat(), source))
            conn.commit()
    
    def log_sync_run(self, status: str, details: dict):
        """Log a price sync run for monitoring"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sync_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    status TEXT,
                    holdings_count INTEGER,
                    success_count INTEGER,
                    fail_count INTEGER,
                    duration_seconds REAL,
                    details TEXT
                )
            """)
            cursor.execute("""
                INSERT INTO sync_runs (status, details)
                VALUES (?, ?)
            """, (status, json.dumps(details)))
            conn.commit()
            return cursor.lastrowid
    
    def update_sync_run(self, run_id: int, **kwargs):
        """Update sync run with completion data"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            fields = []
            values = []
            for key, val in kwargs.items():
                fields.append(f"{key} = ?")
                values.append(val)
            if fields:
                values.append(run_id)
                cursor.execute(f"""
                    UPDATE sync_runs SET {', '.join(fields)}
                    WHERE id = ?
                """, values)
                conn.commit()
    
    def get_last_sync_status(self) -> Optional[dict]:
        """Get the most recent sync run status"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM sync_runs
                ORDER BY started_at DESC
                LIMIT 1
            """)
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None
    
    def get_latest_fx_rate(self, from_currency: str, to_currency: str) -> Optional[float]:
        """Get latest FX rate"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT rate FROM fx_rates 
                WHERE from_currency = ? AND to_currency = ?
                ORDER BY recorded_at DESC
                LIMIT 1
            """, (from_currency, to_currency))
            row = cursor.fetchone()
            return row['rate'] if row else None
    
    def log_price_history(self, symbol: str, price: float, currency: str, source: str):
        """Log price to history table for charting"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            # Create price_history table if not exists
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS price_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    price REAL NOT NULL,
                    currency TEXT,
                    source TEXT,
                    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                INSERT INTO price_history (symbol, price, currency, source, recorded_at)
                VALUES (?, ?, ?, ?, ?)
            """, (symbol, price, currency, source, datetime.now().isoformat()))
            conn.commit()


class PriceFetcher:
    """Fetches prices from multiple sources with fallback"""
    
    def __init__(self):
        self.db = DatabaseManager(DB_PATH)
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        # macOS python.org installers don't ship system trust anchors — use
        # certifi's bundle so CoinGecko/CoinCap/Finnhub/yfinance SSL verifies.
        try:
            import certifi, ssl as _ssl
            ssl_ctx = _ssl.create_default_context(cafile=certifi.where())
            connector = aiohttp.TCPConnector(ssl=ssl_ctx)
        except ImportError:
            connector = None
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=30),
            headers={'Accept': 'application/json'},
            connector=connector,
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def fetch_with_fallback(self, symbol: str, asset_class: str) -> Optional[PriceData]:
        """Try multiple sources until one succeeds"""
        
        if asset_class == 'crypto':
            # Try crypto sources
            for fetcher in [self.fetch_coingecko, self.fetch_coincap]:
                try:
                    result = await fetcher(symbol)
                    if result:
                        return result
                except Exception as e:
                    logger.warning(f"{fetcher.__name__} failed for {symbol}: {e}")
                    continue
        else:
            # Stock sources - Finnhub first (fast, generous limits), then Alpha Vantage, then Yahoo
            try:
                result = await self.fetch_finnhub(symbol)
                if result:
                    return result
            except Exception as e:
                logger.debug(f"Finnhub failed for {symbol}: {e}")
            
            try:
                result = await self.fetch_alpha_vantage(symbol)
                if result:
                    return result
            except Exception as e:
                logger.debug(f"Alpha Vantage failed for {symbol}: {e}")
            
            # Fallback to Yahoo with delay to avoid rate limiting
            try:
                await asyncio.sleep(1)  # Rate limit protection
                result = await self.fetch_yahoo_direct(symbol)
                if result:
                    return result
            except Exception as e:
                logger.debug(f"Yahoo fallback failed for {symbol}: {e}")
            
            return None
        
        return None
    
    async def fetch_coingecko(self, symbol: str) -> Optional[PriceData]:
        """Fetch from CoinGecko API"""
        symbol_map = {
            'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana',
            'XRP': 'ripple', 'SUI': 'sui', 'ADA': 'cardano',
            'DOT': 'polkadot', 'AVAX': 'avalanche-2', 'LINK': 'chainlink'
        }
        
        coin_id = symbol_map.get(symbol.upper(), symbol.lower())
        url = f"https://api.coingecko.com/api/v3/simple/price"
        params = {
            'ids': coin_id,
            'vs_currencies': 'usd',
            'include_24hr_change': 'true',
            'include_market_cap': 'true',
            'include_24hr_vol': 'true'
        }
        
        if COINGECKO_KEY:
            params['x_cg_pro_api_key'] = COINGECKO_KEY
        
        async with self.session.get(url, params=params) as resp:
            if resp.status != 200:
                raise Exception(f"CoinGecko returned {resp.status}")
            
            data = await resp.json()
            if coin_id not in data:
                return None
            
            coin_data = data[coin_id]
            return PriceData(
                symbol=symbol.upper(),
                price=coin_data['usd'],
                currency='USD',
                change_percent_24h=coin_data.get('usd_24h_change'),
                volume_24h=coin_data.get('usd_24h_vol'),
                market_cap=coin_data.get('usd_market_cap'),
                last_updated=datetime.now().isoformat(),
                source='coingecko'
            )
    
    async def fetch_coincap(self, symbol: str) -> Optional[PriceData]:
        """Fetch from CoinCap API (no key needed)"""
        url = f"https://api.coincap.io/v2/assets/{symbol.lower()}"
        
        async with self.session.get(url) as resp:
            if resp.status != 200:
                raise Exception(f"CoinCap returned {resp.status}")
            
            data = await resp.json()
            asset = data.get('data', {})
            
            return PriceData(
                symbol=symbol.upper(),
                price=float(asset['priceUsd']),
                currency='USD',
                change_percent_24h=float(asset.get('changePercent24Hr', 0)),
                volume_24h=float(asset.get('volumeUsd24Hr', 0)),
                market_cap=float(asset.get('marketCapUsd', 0)),
                last_updated=datetime.now().isoformat(),
                source='coincap'
            )
    
    async def fetch_yahoo_jina(self, symbol: str) -> Optional[PriceData]:
        """Fetch from Yahoo Finance via Jina AI (scraping)"""
        if not JINA_API_KEY:
            raise Exception("JINA_API_KEY not configured")
        
        url = f"https://finance.yahoo.com/quote/{symbol.upper()}"
        jina_url = f"https://r.jina.ai/http://{url}"
        
        headers = {'Authorization': f'Bearer {JINA_API_KEY}'}
        
        async with self.session.get(jina_url, headers=headers) as resp:
            if resp.status != 200:
                raise Exception(f"Jina returned {resp.status}")
            
            text = await resp.text()
            
            # Extract price - look for patterns
            import re
            price_match = re.search(r'\$([\d,]+\.?\d{0,2})', text)
            change_match = re.search(r'([+-]?[\d.]+)%', text)
            
            if not price_match:
                return None
            
            price = float(price_match[1].replace(',', ''))
            change_pct = float(change_match[1]) if change_match else None
            
            return PriceData(
                symbol=symbol.upper(),
                price=price,
                currency='USD',
                change_percent_24h=change_pct,
                last_updated=datetime.now().isoformat(),
                source='yahoo_jina'
            )
    
    async def fetch_finnhub(self, symbol: str) -> Optional[PriceData]:
        """Fetch from Finnhub API"""
        if not FINNHUB_KEY:
            raise Exception("FINNHUB_API_KEY not configured")
        
        url = f"https://finnhub.io/api/v1/quote"
        params = {
            'symbol': symbol.upper(),
            'token': FINNHUB_KEY
        }
        
        async with self.session.get(url, params=params) as resp:
            if resp.status != 200:
                raise Exception(f"Finnhub returned {resp.status}")
            
            data = await resp.json()
            
            if data.get('c') == 0:
                return None
            
            current = data['c']
            previous = data.get('pc', current)
            change_pct = ((current - previous) / previous * 100) if previous else None
            
            return PriceData(
                symbol=symbol.upper(),
                price=current,
                currency='USD',
                change_percent_24h=change_pct,
                last_updated=datetime.now().isoformat(),
                source='finnhub'
            )
    
    async def fetch_alpha_vantage(self, symbol: str) -> Optional[PriceData]:
        """Fetch from Alpha Vantage API"""
        if not ALPHA_VANTAGE_KEY:
            raise Exception("ALPHA_VANTAGE_API_KEY not configured")
        
        url = "https://www.alphavantage.co/query"
        params = {
            'function': 'GLOBAL_QUOTE',
            'symbol': symbol.upper(),
            'apikey': ALPHA_VANTAGE_KEY
        }
        
        async with self.session.get(url, params=params) as resp:
            if resp.status != 200:
                raise Exception(f"Alpha Vantage returned {resp.status}")
            
            data = await resp.json()
            quote = data.get('Global Quote', {})
            
            if not quote:
                return None
            
            return PriceData(
                symbol=symbol.upper(),
                price=float(quote.get('05. price', 0)),
                currency='USD',
                change_percent_24h=float(quote.get('10. change percent', '0').replace('%', '')),
                volume_24h=float(quote.get('06. volume', 0)),
                last_updated=quote.get('07. latest trading day'),
                source='alphavantage'
            )
    
    async def fetch_yahoo_direct(self, symbol: str) -> Optional[PriceData]:
        """Fetch from Yahoo Finance API directly (may have CORS issues in browser but works server-side)"""
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol.upper()}"
        params = {
            'interval': '1d',
            'range': '1d'
        }
        
        async with self.session.get(url, params=params) as resp:
            if resp.status != 200:
                raise Exception(f"Yahoo returned {resp.status}")
            
            data = await resp.json()
            result = data.get('chart', {}).get('result', [{}])[0]
            
            if not result:
                return None
            
            meta = result['meta']
            price = meta.get('regularMarketPrice')
            prev_close = meta.get('previousClose') or meta.get('chartPreviousClose')
            
            change_pct = None
            if price and prev_close:
                change_pct = ((price - prev_close) / prev_close) * 100
            
            return PriceData(
                symbol=symbol.upper(),
                price=price,
                currency=meta.get('currency', 'USD'),
                change_percent_24h=change_pct,
                last_updated=datetime.now().isoformat(),
                source='yahoo_direct'
            )
    
    async def update_all_holdings(self):
        """Update prices for all holdings in database with sync tracking and validation"""
        import time
        start_time = time.time()
        
        holdings = self.db.get_all_holdings()
        total = len(holdings)
        
        # Log sync start
        run_id = self.db.log_sync_run('running', {
            'total_holdings': total,
            'symbols': [h['symbol'] for h in holdings]
        })
        
        logger.info(f"[Sync #{run_id}] Updating prices for {total} holdings")
        
        # Group by asset class for batch operations
        crypto_symbols = []
        stock_symbols = []
        
        for h in holdings:
            symbol = h['symbol']
            asset_class = h.get('asset_class', 'equity')
            
            if asset_class == 'crypto':
                crypto_symbols.append(symbol)
            else:
                stock_symbols.append(symbol)
        
        success_count = 0
        fail_count = 0
        source_stats = {}
        validation_failures = []
        
        # Fetch crypto prices in batch where possible
        if crypto_symbols:
            crypto_success = await self._batch_update_crypto(crypto_symbols)
            success_count += crypto_success
            fail_count += len(crypto_symbols) - crypto_success
            source_stats['coingecko'] = crypto_success
        
        # Fetch stock prices individually (most APIs require individual calls)
        for symbol in stock_symbols:
            try:
                price_data = await self.fetch_with_fallback(symbol, 'equity')
                
                # Validate price data before updating
                if not price_data:
                    fail_count += 1
                    logger.warning(f"Could not fetch price for {symbol}")
                    continue
                    
                # Sanity check: price should be > 0 and reasonable
                if price_data.price <= 0:
                    fail_count += 1
                    validation_failures.append(f"{symbol}: price <= 0 ({price_data.price})")
                    logger.warning(f"Invalid price for {symbol}: {price_data.price}")
                    continue
                
                # Get current cost basis for comparison
                current_data = self.db.get_holding_price(symbol)
                if current_data:
                    cost_basis = current_data.get('cost_basis_per_share', 0)
                    current_price = current_data.get('current_price', 0)
                    
                    # Check for suspicious price changes (>90% drop or >10x increase)
                    if current_price > 0:
                        change_pct = abs((price_data.price - current_price) / current_price * 100)
                        if change_pct > 90 and price_data.price < current_price:
                            # Suspicious large drop - flag but still update if from reliable source
                            if price_data.source not in ['yahoo_direct', 'alphavantage', 'finnhub']:
                                validation_failures.append(f"{symbol}: suspicious {change_pct:.1f}% drop")
                                logger.warning(f"Suspicious price drop for {symbol}: {current_price} -> {price_data.price} ({change_pct:.1f}%)")
                                # Still update but log it
                        
                        # Check for >10x increase (possible stock split or bad data)
                        if price_data.price > current_price * 10:
                            validation_failures.append(f"{symbol}: suspicious {price_data.price/current_price:.1f}x increase")
                            logger.warning(f"Suspicious price increase for {symbol}: {current_price} -> {price_data.price}")
                            continue
                
                # Price looks valid - update database
                self.db.update_holding_price(symbol, price_data)
                self.db.log_price_history(symbol, price_data.price, price_data.currency, price_data.source)
                success_count += 1
                source_stats[price_data.source] = source_stats.get(price_data.source, 0) + 1
                
            except Exception as e:
                fail_count += 1
                logger.error(f"Error updating {symbol}: {e}")
        
        duration = time.time() - start_time
        
        # Update sync run with results
        status = 'success' if fail_count == 0 else ('partial' if success_count > 0 else 'failed')
        details = {
            'sources': source_stats,
            'crypto_count': len(crypto_symbols),
            'stock_count': len(stock_symbols),
            'validation_failures': validation_failures[:10]  # Limit to first 10
        }
        
        self.db.update_sync_run(
            run_id=run_id,
            status=status,
            completed_at=datetime.now().isoformat(),
            holdings_count=total,
            success_count=success_count,
            fail_count=fail_count,
            duration_seconds=round(duration, 2),
            details=json.dumps(details)
        )
        
        logger.info(f"[Sync #{run_id}] Completed: {success_count}/{total} success, {duration:.1f}s")
        return {
            'run_id': run_id,
            'status': status,
            'success': success_count,
            'failed': fail_count,
            'duration': duration,
            'sources': source_stats
        }
    
    async def _batch_update_crypto(self, symbols: List[str]) -> int:
        """Batch update crypto prices using CoinGecko. Returns success count."""
        symbol_map = {
            'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana',
            'XRP': 'ripple', 'SUI': 'sui', 'ADA': 'cardano',
            'DOT': 'polkadot', 'AVAX': 'avalanche-2', 'LINK': 'chainlink',
            'MATIC': 'matic-network', 'UNI': 'uniswap', 'AAVE': 'aave'
        }
        
        coin_ids = []
        symbol_to_id = {}
        
        for sym in symbols:
            coin_id = symbol_map.get(sym.upper(), sym.lower())
            coin_ids.append(coin_id)
            symbol_to_id[coin_id] = sym.upper()
        
        url = "https://api.coingecko.com/api/v3/simple/price"
        params = {
            'ids': ','.join(coin_ids),
            'vs_currencies': 'usd',
            'include_24hr_change': 'true',
            'include_market_cap': 'true',
            'include_24hr_vol': 'true'
        }
        
        if COINGECKO_KEY:
            params['x_cg_pro_api_key'] = COINGECKO_KEY
        
        success_count = 0
        try:
            async with self.session.get(url, params=params) as resp:
                if resp.status != 200:
                    raise Exception(f"CoinGecko batch returned {resp.status}")
                
                data = await resp.json()
                
                for coin_id, coin_data in data.items():
                    symbol = symbol_to_id.get(coin_id, coin_id.upper())
                    price_data = PriceData(
                        symbol=symbol,
                        price=coin_data['usd'],
                        currency='USD',
                        change_percent_24h=coin_data.get('usd_24h_change'),
                        volume_24h=coin_data.get('usd_24h_vol'),
                        market_cap=coin_data.get('usd_market_cap'),
                        last_updated=datetime.now().isoformat(),
                        source='coingecko'
                    )
                    self.db.update_holding_price(symbol, price_data)
                    self.db.log_price_history(symbol, price_data.price, price_data.currency, price_data.source)
                    success_count += 1
                    
        except Exception as e:
            logger.error(f"Batch crypto update failed: {e}")
            # Fall back to individual updates
            for symbol in symbols:
                try:
                    price_data = await self.fetch_with_fallback(symbol, 'crypto')
                    if price_data:
                        self.db.update_holding_price(symbol, price_data)
                        success_count += 1
                except Exception as e2:
                    logger.error(f"Individual crypto update failed for {symbol}: {e2}")
        
        return success_count


def maybe_snapshot_net_worth():
    """Record one net_worth_history row per day, idempotently."""
    today = datetime.now().strftime('%Y-%m-%d')
    try:
        conn = sqlite3.connect(DB_PATH)
        existing = conn.execute(
            "SELECT 1 FROM net_worth_history WHERE snapshot_date = ? LIMIT 1",
            (today,),
        ).fetchone()
        conn.close()
        if existing:
            return
        # Lazy import to avoid circular deps and so that sync still runs
        # if wealthguard_utils is missing (e.g. in a slimmed deployment).
        from wealthguard_utils import update_net_worth
        update_net_worth()
    except Exception as e:
        logger.warning(f"net_worth snapshot skipped: {e}")


def maybe_detect_recurring():
    """Run recurring-transaction detection at most once a day."""
    stamp_file = '/tmp/wealthguard_recurring_stamp'
    today = datetime.now().strftime('%Y-%m-%d')
    try:
        if os.path.exists(stamp_file):
            with open(stamp_file) as f:
                if f.read().strip() == today:
                    return
        from wealthguard_recurring import detect
        detect(update=True)
        with open(stamp_file, 'w') as f:
            f.write(today)
    except Exception as e:
        logger.warning(f"recurring detection skipped: {e}")


def maybe_refresh_podbits(max_per_source: int = 5):
    """Re-ingest every active PodBits source at most once per 24h.

    Pulls new episodes from RSS / YouTube, skips duplicates, then runs the
    AI analyst over anything that's missing ai_analysis. Gated by a
    /tmp stamp so restarting the API doesn't re-fire on every boot.
    """
    stamp_file = '/tmp/wealthguard_podbits_stamp'
    today = datetime.now().strftime('%Y-%m-%d')
    try:
        if os.path.exists(stamp_file):
            with open(stamp_file) as f:
                if f.read().strip() == today:
                    return
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        sources = conn.execute(
            "SELECT id FROM podbits_sources WHERE is_active = 1"
        ).fetchall()
        conn.close()
        if not sources:
            return

        from podbits_ingest import process_source
        total_new = 0
        for s in sources:
            try:
                result = process_source(s['id'], max_episodes=max_per_source)
                total_new += (result or {}).get('processed', 0)
            except Exception as e:
                logger.warning(f"podbits source {s['id']} refresh failed: {e}")

        # Analyst pass on anything still missing ai_analysis.
        try:
            from podbits_ai_analyst import analyze_batch
            analyze_batch(limit=40, force=False)
        except Exception as e:
            logger.warning(f"podbits analyst batch skipped: {e}")

        with open(stamp_file, 'w') as f:
            f.write(today)
        logger.info(f"PodBits daily refresh: {total_new} new episodes across {len(sources)} sources")
    except Exception as e:
        logger.warning(f"podbits daily refresh skipped: {e}")


async def main():
    """Run price sync once"""
    async with PriceFetcher() as fetcher:
        await fetcher.update_all_holdings()
        logger.info("Price sync completed")
    maybe_snapshot_net_worth()
    maybe_detect_recurring()
    maybe_refresh_podbits()


if __name__ == '__main__':
    asyncio.run(main())
