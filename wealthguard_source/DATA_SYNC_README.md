---
type: note
created: 2026-04-01
tags: [note, personal]
---

# WealthGuard Live Data Setup

## Table of Contents

- [[#What We Built]]
- [[#Quick Start]]
- [[#API Endpoints]]
- [[#Adding API Keys (Optional but Recommended)]]
- [[#How It Works]]
- [[#Troubleshooting]]
- [[#Data Sources Priority]]
- [[#Files Added]]


## What We Built

**Backend Data Sync System** that:
- Fetches live prices from CoinGecko (crypto) and Yahoo Finance/Finnhub (stocks)
- Updates your SQLite database with real prices
- Serves data via REST API to the frontend
- Updates every 5 minutes automatically

## Quick Start

### 1. Install Python Dependencies
```bash
cd /root/.openclaw/workspace
pip3 install -r requirements.txt
```

### 2. Start the Backend
```bash
./start_backend.sh
```

This starts:
- API server on `http://localhost:8000`
- Price sync scheduler (every 5 minutes)

### 3. Start the Frontend
```bash
cd /root/.openclaw/workspace/wealthguard-web
npm run dev
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/holdings` | Your portfolio holdings with live prices |
| `GET /api/portfolio/summary` | Portfolio value and P&L |
| `GET /api/markets/{US\|AU\|CN\|CRYPTO}` | Market data for region |
| `POST /api/sync/prices` | Trigger manual price sync |
| `GET /api/prices/history/{symbol}` | Price history for charts |
| `GET /docs` | Interactive API documentation |

## Adding API Keys (Optional but Recommended)

Edit `.env` and add keys for better reliability:

```bash
# Best free option for stocks
FINNHUB_API_KEY=your_key_here  # 60 calls/min free

# For Yahoo Finance scraping
JINA_API_KEY=your_key_here  # 200 requests/day free

# Get keys at:
# - Finnhub: https://finnhub.io/register
# - Jina AI: https://jina.ai/api-dashboard
```

Without keys, the system uses:
- CoinGecko (free, no key) for crypto
- Yahoo Finance direct API (may be less reliable)

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   CoinGecko     │     │ Yahoo/Finnhub   │     │   Frontend      │
│   (Crypto)      │     │   (Stocks)      │     │  (React/Vite)   │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────┬───────────┘                       │
                     │                                   │
                     ▼                                   │
            ┌─────────────────┐                          │
            │  Data Sync      │◄─────── POST /sync       │
            │  (Python)       │                          │
            └────────┬────────┘                          │
                     │                                   │
                     ▼                                   ▼
            ┌─────────────────┐                 ┌─────────────────┐
            │  SQLite DB      │◄────────────────│  API Server     │
            │  wealthguard.db │    GET /api/*   │  (FastAPI)      │
            └─────────────────┘                 └─────────────────┘
```

## Troubleshooting

**API not responding?**
```bash
# Check if API is running
curl http://localhost:8000/

# Check logs
tail -f /tmp/wealthguard_api.log
tail -f /tmp/wealthguard_sync.log
```

**Prices not updating?**
```bash
# Run sync manually
python3 wealthguard_data_sync.py

# Check if holdings exist
sqlite3 wealthguard.db "SELECT symbol, shares FROM holdings WHERE shares > 0;"
```

**CORS errors in browser?**
The Vite dev server proxies `/api` to `localhost:8000`. If you deploy separately, set `VITE_API_URL` environment variable.

## Data Sources Priority

### Crypto
1. CoinGecko (free, no key) - Primary
2. CoinCap (free, no key) - Fallback

### Stocks
1. Finnhub (free tier: 60/min) - Primary (if key configured)
2. Yahoo Finance via Jina (200/day) - Secondary
3. Yahoo Finance direct - Fallback
4. Alpha Vantage (25/day) - Last resort

## Files Added

| File | Purpose |
|------|---------|
| `wealthguard_api.py` | FastAPI server |
| `wealthguard_data_sync.py` | Price fetching & database updates |
| `start_backend.sh` | Launcher script |
| `requirements.txt` | Python dependencies |
| `.env` | Configuration |
| `wealthguard-web/src/pages/Markets.tsx` | Updated to use live API |
| `wealthguard-web/vite.config.ts` | Proxy config for dev |
