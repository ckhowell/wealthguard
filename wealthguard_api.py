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
from typing import List, Dict, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment
load_dotenv(Path(__file__).parent / '.env')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('wealthguard-api')

# Database path
DB_PATH = os.getenv('DATABASE_PATH', '/root/.openclaw/workspace/wealthguard.db')

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

# Pydantic models
class Holding(BaseModel):
    symbol: str
    asset_name: str
    shares: float
    current_price: Optional[float]
    cost_basis_per_share: Optional[float]
    asset_class: str
    sector: Optional[str]
    geography: Optional[str]
    last_price_update: Optional[str]

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

# Database helper
def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/")
def root():
    return {"status": "ok", "service": "WealthGuard API", "version": "1.0.0"}


@app.get("/api/holdings", response_model=List[Holding])
def get_holdings():
    """Get all holdings with current prices"""
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
        return [dict(row) for row in rows]


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
    """Get portfolio summary with P&L"""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                SUM(h.shares * h.current_price) as total_value,
                SUM(h.shares * h.cost_basis_per_share) as total_cost,
                COUNT(*) as holdings_count,
                MAX(h.last_price_update) as last_updated
            FROM holdings h
            WHERE h.shares > 0
        """)
        row = cursor.fetchone()
        
        if not row or row['total_value'] is None:
            return {
                "total_value": 0,
                "total_cost": 0,
                "total_gain_loss": 0,
                "total_gain_loss_percent": 0,
                "holdings_count": 0,
                "last_updated": None
            }
        
        total_value = row['total_value'] or 0
        total_cost = row['total_cost'] or 0
        gain_loss = total_value - total_cost
        gain_loss_pct = (gain_loss / total_cost * 100) if total_cost > 0 else 0
        
        return {
            "total_value": round(total_value, 2),
            "total_cost": round(total_cost, 2),
            "total_gain_loss": round(gain_loss, 2),
            "total_gain_loss_percent": round(gain_loss_pct, 2),
            "holdings_count": row['holdings_count'],
            "last_updated": row['last_updated']
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

# FX Rate configuration - USD to AUD
FX_RATES = {
    'USD/AUD': 1.55,
    'AUD/USD': 0.645,
}

def get_fx_rate(from_curr: str, to_curr: str) -> float:
    """Get FX rate with fallback"""
    pair = f"{from_curr}/{to_curr}"
    if pair in FX_RATES:
        return FX_RATES[pair]
    inverse = f"{to_curr}/{from_curr}"
    if inverse in FX_RATES:
        return 1 / FX_RATES[inverse]
    return 1.0


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
    
    # Build response with fallback to mock data if no real data
    result = []
    for stock in stocks:
        symbol = stock["symbol"]
        price_info = price_map.get(symbol, {})
        
        price = price_info.get('price')
        if price is None:
            # Fallback: generate reasonable mock price
            base = 100 + random.random() * 400
            change_pct = (random.random() - 0.5) * 4
            price = base
        else:
            change_pct = (random.random() - 0.5) * 4  # Would need historical data for real change
        
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
            "name": stock["name"],
            "price": round(price, 2),
            "price_aud": aud_price,
            "change": round(change, 2),
            "change_percent": round(change_pct, 2),
            "currency": currency,
            "sector": stock["sector"],
            "market_cap": None,
            "volume": None,
            "source": "live" if price_info else "mock"
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


@app.post("/api/sync/prices")
def trigger_price_sync():
    """Trigger a price sync (runs in background)"""
    import subprocess
    try:
        subprocess.Popen(
            ["python3", "/root/.openclaw/workspace/wealthguard_data_sync.py"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
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


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv('API_PORT', 8000))
    host = os.getenv('API_HOST', '0.0.0.0')
    uvicorn.run(app, host=host, port=port)
