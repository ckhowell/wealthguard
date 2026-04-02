#!/usr/bin/env python3
"""
Simple WealthGuard Price Sync - Uses yfinance (reliable)
"""
import sqlite3
import yfinance as yf
from datetime import datetime
import logging
import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('wealthguard-sync')

DB_PATH = '/root/.openclaw/workspace/wealthguard.db'

# FX Rate cache
FX_RATES = {
    'JPY': 0.009117,  # JPY to AUD
    'USD': 1.55,      # USD to AUD
}

# Manual price overrides (for assets that yfinance gets wrong)
MANUAL_PRICES = {
    'SUI': 0.86,  # yfinance returns wrong price for SUI
}

def get_fx_rate(from_currency, to_currency='AUD'):
    """Get FX rate from cache or API"""
    if from_currency == to_currency:
        return 1.0
    
    # Check cache first
    if from_currency in FX_RATES:
        return FX_RATES[from_currency]
    
    return 1.0

def get_crypto_price(symbol):
    """Fetch crypto price from CoinGecko API"""
    try:
        coin_id_map = {
            'BTC': 'bitcoin',
            'ETH': 'ethereum', 
            'SOL': 'solana',
            'XRP': 'ripple',
            'SUI': 'sui',
            'ADA': 'cardano',
            'DOT': 'polkadot',
            'AVAX': 'avalanche-2',
            'LINK': 'chainlink',
            'MATIC': 'matic-network',
            'UNI': 'uniswap',
            'AAVE': 'aave'
        }
        
        coin_id = coin_id_map.get(symbol.upper())
        if not coin_id:
            return None
            
        url = f"https://api.coingecko.com/api/v3/simple/price?ids={coin_id}&vs_currencies=usd"
        response = requests.get(url, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            return data.get(coin_id, {}).get('usd')
        
        return None
    except Exception as e:
        logger.warning(f"CoinGecko failed for {symbol}: {e}")
        return None

def sync_prices():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get only equity and crypto holdings (skip alternative/real estate/vehicles)
    cursor.execute("""
        SELECT symbol, asset_name, asset_class 
        FROM holdings 
        WHERE shares > 0 
        AND asset_class IN ('equity', 'crypto')
    """)
    holdings = cursor.fetchall()
    
    updated = 0
    failed = 0
    
    for holding in holdings:
        symbol = holding['symbol']
        asset_class = holding['asset_class']
        
        # Check manual overrides first
        if symbol.upper() in MANUAL_PRICES:
            price = MANUAL_PRICES[symbol.upper()]
            cursor.execute("""
                UPDATE holdings 
                SET current_price = ?, last_price_update = ?
                WHERE symbol = ?
            """, (price, datetime.now().isoformat(), symbol))
            logger.info(f"✓ {symbol}: ${price} (manual override)")
            updated += 1
            continue
        
        price = None
        
        try:
            if asset_class == 'crypto':
                # Try CoinGecko first for crypto
                price = get_crypto_price(symbol)
                
                # Fallback to yfinance
                if not price:
                    ticker_formats = [f"{symbol}-USD", f"{symbol}-AUD", symbol]
                    for tf in ticker_formats:
                        try:
                            ticker = yf.Ticker(tf)
                            info = ticker.info
                            price = info.get('regularMarketPrice') or info.get('previousClose')
                            if price:
                                break
                        except:
                            continue
            else:
                # Stocks - use yfinance
                ticker = yf.Ticker(symbol)
                info = ticker.info
                price = info.get('regularMarketPrice') or info.get('previousClose')
            
            if price:
                cursor.execute("""
                    UPDATE holdings 
                    SET current_price = ?, last_price_update = ?
                    WHERE symbol = ?
                """, (price, datetime.now().isoformat(), symbol))
                
                logger.info(f"✓ {symbol}: ${price}")
                updated += 1
            else:
                logger.warning(f"✗ {symbol}: No price found")
                failed += 1
                
        except Exception as e:
            logger.error(f"✗ {symbol}: {e}")
            failed += 1
    
    # Update FX rates
    try:
        cursor.execute("""
            INSERT INTO fx_rates (from_currency, to_currency, rate, recorded_at, source)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING
        """, ('JPY', 'AUD', FX_RATES['JPY'], datetime.now().isoformat(), 'manual'))
        cursor.execute("""
            INSERT INTO fx_rates (from_currency, to_currency, rate, recorded_at, source)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING
        """, ('USD', 'AUD', FX_RATES['USD'], datetime.now().isoformat(), 'manual'))
        logger.info(f"FX rates updated: JPY/AUD={FX_RATES['JPY']}, USD/AUD={FX_RATES['USD']}")
    except Exception as e:
        logger.warning(f"FX rate update skipped: {e}")
    
    conn.commit()
    conn.close()
    
    logger.info(f"\nSync complete: {updated} updated, {failed} failed")

if __name__ == '__main__':
    sync_prices()
