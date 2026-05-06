---
type: note
created: 2026-04-21
tags: [note, personal]
---

# WealthGuard — Improvement Brief for Claude AI

## Table of Contents

- [[#1. What Is WealthGuard?]]
- [[#2. Architecture Overview]]
- [[#3. Current Feature Set (12 Pages)]]
- [[#4. Tech Stack Details]]
- [[#5. Known Issues & Pain Points]]
- [[#6. User Context]]
- [[#7. Specific Improvement Areas (Priority Order)]]
- [[#8. Key Files to Know]]
- [[#9. How to Run]]
- [[#10. Design Notes]]
- [[#11. What NOT to Change]]
- [[#12. Success Criteria]]


> **Prepared by:** Kimi Claw  
> **Date:** April 21, 2026  
> **Purpose:** Provide context for Claude AI to improve the WealthGuard UI and application

---

## 1. What Is WealthGuard?

**WealthGuard** is a personal wealth management and portfolio tracking application built for a high-net-worth individual (approx. ~$3.8M AUD net worth, heavily real-estate concentrated). It is designed around **data sovereignty** — no bank aggregators (Plaid, Yodlee), no third-party tracking. Everything runs locally.

### Core Philosophy
- **Local-first**: SQLite database, self-hosted backend
- **AI-powered insights**: Market intelligence, news aggregation, portfolio analysis
- **Multi-asset**: Real estate, cash, crypto, stocks, vehicles
- **Active monitoring**: Price sync every 5 min, alerts, autonomous health checks

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
│              React 19 + TypeScript + Vite                   │
│              Tailwind CSS v4 + Recharts + Lucide            │
│                     Port: 5173                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│  │Dashboard│ │Portfolio│ │ Markets │ │Budgets  │ ...      │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘         │
└────────────────────┬────────────────────────────────────────┘
                     │  /api/*  (proxied via Vite)
┌────────────────────┴────────────────────────────────────────┐
│                        BACKEND                              │
│              FastAPI (Python) + SQLite                      │
│                     Port: 8000                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │ Price Sync  │ │  Portfolio  │ │  Intelligence Eng.  │  │
│  │  (yfinance) │ │    API      │ │   (news/sentiment)  │  │
│  └─────────────┘ └─────────────┘ └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Sources
| Asset Class | Primary Source | Fallback |
|-------------|---------------|----------|
| Crypto | CoinGecko | CoinCap |
| US Stocks | Finnhub | Yahoo Finance, Alpha Vantage |
| A-Shares (CN) | kimi_finance (ifind) | — |
| News/Intel | NewsAPI, GNews | RSS feeds |
| Podcast Intel | YouTube descriptions | Manual extraction |

---

## 3. Current Feature Set (12 Pages)

| Page | File | Description | Status |
|------|------|-------------|--------|
| **Dashboard** | `pages/Dashboard.tsx` | Net worth overview, asset allocation pie chart, live prices, budget status | ✅ Active |
| **Portfolio** | `pages/Portfolio.tsx` | Full holdings list, add/edit/delete, P&L tracking | ✅ Active |
| **Rebalancer** | `pages/Rebalancer.tsx` | Target allocation sliders, drift analysis, rebalance suggestions | ✅ Active |
| **Performance** | `pages/Performance.tsx` | Historical performance charts | ⚠️ Basic |
| **Cash Flow** | `pages/CashFlow.tsx` | Income/expense tracking | ⚠️ Basic |
| **Advisor** | `pages/Advisor.tsx` | AI-driven recommendations, risk analysis | ✅ Active |
| **PodBits** | `pages/PodBits.tsx` | Podcast intelligence digest (17 episodes) | ✅ Active |
| **Markets** | `pages/Markets.tsx` | US/AU/CN market overview | ✅ Active |
| **A-Share** | `pages/AShare.tsx` | China A-share tracking | ✅ Active |
| **Transactions** | `pages/Transactions.tsx` | Transaction history/import | ⚠️ Basic |
| **Budgets** | `pages/Budgets.tsx` | Budget tracking and alerts | ⚠️ Basic |
| **Alerts** | `pages/Alerts.tsx` | Price alerts, system notifications | ✅ Active |

### Key Components
- `SyncDashboard` — Live sync status, success rates, data source breakdown
- `NetWorthTracker` — Net worth history and trends
- `CurrencyConverter` — JPY/AUD/USD conversions
- `RiskAnalysis` — Portfolio risk metrics
- `ToastContainer` — Notification system

---

## 4. Tech Stack Details

### Frontend
```json
{
  "framework": "React 19.2.4",
  "language": "TypeScript 5.9.3",
  "build": "Vite 8.0.1",
  "styling": "Tailwind CSS 4.2.2",
  "charts": "Recharts 3.8.1",
  "icons": "Lucide React 1.7.0",
  "routing": "React Router DOM 7.13.2",
  "dates": "date-fns 4.1.0"
}
```

### Backend
```python
{
  "framework": "FastAPI",
  "database": "SQLite (wealthguard.db)",
  "price_fetching": "yfinance, CoinGecko, Finnhub, Alpha Vantage",
  "async": "APScheduler for cron jobs",
  "environment": "python-dotenv"
}
```

### Dev Environment
- **OS**: Linux (Ubuntu)
- **Node**: v22.22.1
- **Python**: 3.12
- **Proxy**: Vite dev server proxies `/api` → `localhost:8000`

---

## 5. Known Issues & Pain Points

### UI/UX Issues
1. **Stale data display** — Dashboard shows hardcoded net worth (`$3,828,255.31`) in header, not live from API
2. **No loading states** — Many pages lack skeleton loaders or proper loading feedback
3. **Mobile responsiveness** — Sidebar doesn't collapse properly on small screens; tables overflow
4. **No dark mode** — Only light theme available
5. **Inconsistent spacing** — Some pages use different padding/margins
6. **Chart tooltips** — Basic, not informative enough

### Data Issues
1. **Hardcoded holdings** — Dashboard has `defaultHoldings` embedded in component; should fetch from API
2. **USD/AUD rate hardcoded** — `1.447` is static; should be live
3. **Net worth history is fake** — 6 months of synthetic data, not from database
4. **Budget data is static** — Not connected to real transaction data

### Code Quality Issues
1. **No error boundaries** — React crashes can take down the whole app
2. **No retry logic** — API calls fail silently or show generic errors
3. **Prop drilling** — Some components pass data through too many layers
4. **Missing tests** — Zero test coverage
5. **Type safety gaps** — Several `any` types in components

### Feature Gaps
1. **No transaction import UI** — CSV import exists in backend utils but no frontend for it
2. **No recurring transaction tracking**
3. **No goal setting** — No financial goals or milestone tracking
4. **No tax reporting** — No capital gains/loss calculations
5. **No export functionality** — Can't export portfolio data (except rebalancer CSV)

---

## 6. User Context

From `USER.md`:
- **Timezone:** Brisbane AEST (UTC+10)
- **Language:** English preferred (not Chinese)
- **Net worth:** ~$3.8M AUD
- **Asset concentration:** Heavy real estate (~65%), JPY exposure (~$500K)
- **Preferences:** Direct, no-nonsense communication; values data sovereignty

### User Complaints (from memory)
- "Hallucinations" in Telegram updates → Fixed by reducing auto-messages
- Stale/incorrect Cloudflare URLs in notifications → Fixed
- Duplicate price alerts → Fixed with rate limiting
- PodBits AI summaries were poor (chapter markers, not real summaries) → Partially fixed with enhanced extraction

---

## 7. Specific Improvement Areas (Priority Order)

### 🔴 High Priority

#### 1. Live Data Integration
- **Problem:** Dashboard header shows hardcoded `$3,828,255.31`. Portfolio page has embedded `defaultHoldings`. Budget data is static.
- **Goal:** All pages should fetch from `/api/portfolio/summary`, `/api/holdings`, etc.
- **Files:** `Dashboard.tsx`, `Portfolio.tsx`, `Budgets.tsx`

#### 2. Mobile Responsiveness
- **Problem:** Sidebar is fixed width; tables overflow; charts don't resize well.
- **Goal:** Usable on phone/tablet. Collapsible sidebar, horizontal-scroll tables, responsive charts.
- **Files:** `App.tsx` (sidebar), all page components with tables

#### 3. Error Handling & Loading States
- **Problem:** Blank screens on API failure. No retry. Generic error messages.
- **Goal:** Skeleton loaders, error boundaries, retry buttons, user-friendly error messages.
- **Files:** All page components

### 🟡 Medium Priority

#### 4. Dark Mode
- **Goal:** Toggle between light/dark themes. Tailwind v4 supports this well.
- **Files:** `index.css`, `App.tsx` (add toggle), all components

#### 5. Transaction Import UI
- **Problem:** `wealthguard_utils.py` has CSV import, but no frontend for it.
- **Goal:** Drag-and-drop CSV upload, column mapping, preview before import.
- **Files:** New `pages/Import.tsx` or modal in `Transactions.tsx`

#### 6. Net Worth History (Real)
- **Problem:** `netWorthHistory` array in Dashboard is 6 months of fake data.
- **Goal:** Query database for historical snapshots, display actual trend.
- **Files:** `Dashboard.tsx`, backend API endpoint for history

#### 7. Currency Exchange Rate (Live)
- **Problem:** `USD_TO_AUD = 1.447` is hardcoded everywhere.
- **Goal:** Fetch live FX rates, cache them, display last updated time.
- **Files:** `services/priceService.ts`, all components using the rate

### 🟢 Lower Priority

#### 8. Goal Tracking
- **Goal:** Set financial goals (e.g., "Reach $4M by end of year"), track progress.
- **Files:** New `pages/Goals.tsx`

#### 9. Tax Reporting
- **Goal:** Capital gains/losses report, unrealized vs realized P&L.
- **Files:** New `pages/Tax.tsx` or section in `Portfolio.tsx`

#### 10. Test Coverage
- **Goal:** Unit tests for utilities, component tests for critical paths.
- **Files:** New test files

---

## 8. Key Files to Know

### Frontend
```
wealthguard-web/
├── src/
│   ├── App.tsx                    # Main layout, sidebar, routing
│   ├── index.css                  # Global styles, Tailwind imports
│   ├── pages/
│   │   ├── Dashboard.tsx          # Main overview (needs live data)
│   │   ├── Portfolio.tsx          # Holdings CRUD
│   │   ├── Rebalancer.tsx         # Allocation analysis
│   │   ├── Markets.tsx            # Market data
│   │   ├── Advisor.tsx            # AI recommendations
│   │   ├── PodBits.tsx            # Podcast intel
│   │   ├── Alerts.tsx             # Alert management
│   │   ├── Budgets.tsx            # Budget tracking
│   │   ├── Transactions.tsx       # Transaction history
│   │   ├── Performance.tsx        # Performance charts
│   │   ├── CashFlow.tsx           # Cash flow analysis
│   │   └── AShare.tsx             # China A-shares
│   ├── components/
│   │   ├── SyncDashboard.tsx      # Sync status widget
│   │   ├── NetWorthTracker.tsx    # Net worth card
│   │   ├── CurrencyConverter.tsx  # FX converter
│   │   ├── RiskAnalysis.tsx       # Risk metrics
│   │   └── ToastContainer.tsx     # Notifications
│   ├── services/
│   │   ├── priceService.ts        # Price fetching logic
│   │   ├── priceServiceEnhanced.ts
│   │   ├── database.ts            # DB interactions
│   │   └── ashare/ashareService.ts
│   └── hooks/
│       └── usePersistentState.ts  # LocalStorage hook + toast
├── package.json
├── vite.config.ts                 # Proxy /api to localhost:8000
└── tailwind.config.js
```

### Backend
```
workspace/
├── wealthguard_api.py             # FastAPI server
├── wealthguard_data_sync.py       # Price sync scheduler
├── wealthguard_utils.py           # DB utilities, CSV import
├── wealthguard_alerts.py          # Alert engine
├── wealthguard_health.py          # System health monitor
├── intelligence_engine.py         # News/sentiment aggregation
├── podbits_ai.py                  # Podcast summarization
├── podbits_ingest.py              # Podcast ingestion
├── wealthguard.db                 # SQLite database
├── start_backend.sh               # Launcher
└── requirements.txt
```

---

## 9. How to Run

```bash
# Terminal 1 — Backend
cd /root/.openclaw/workspace
./start_backend.sh
# → API at http://localhost:8000
# → Docs at http://localhost:8000/docs

# Terminal 2 — Frontend
cd /root/.openclaw/workspace/wealthguard-web
npm run dev
# → UI at http://localhost:5173
# → /api proxied to localhost:8000
```

### API Endpoints (Key Ones)
```
GET  /api/holdings              # Portfolio with live prices
GET  /api/portfolio/summary     # Total value, P&L
GET  /api/markets/{US|AU|CN|CRYPTO}
GET  /api/prices/history/{symbol}
GET  /api/sync/status           # Latest sync info
POST /api/sync/prices           # Trigger manual sync
GET  /api/alerts                # Alert history
```

---

## 10. Design Notes

### Current Color Scheme
- **Primary:** Blue (`#3b82f6`)
- **Background:** Slate-50 (`#f8fafc`)
- **Sidebar:** Slate-900 (`#0f172a`)
- **Success:** Green-600
- **Danger:** Red-600
- **Warning:** Yellow-500 / Amber-300

### Typography
- Default Tailwind font stack (Inter/system-ui)
- Metric cards: `text-2xl font-bold`
- Headers: `text-lg font-semibold`

### Icons
- **Lucide React** throughout — consistent, clean line icons

### Reference Style
The user likes **clean, data-dense, professional** interfaces. Think:
- **Bloomberg Terminal** (information density)
- **Wealthfront** (cleanliness)
- **Notion** (simplicity)

Avoid: purple-blue gradients, generic AI chatbot aesthetics, excessive whitespace, emoji overload.

---

## 11. What NOT to Change

1. **Data sovereignty** — Don't add Plaid/Yodlee or any bank aggregator
2. **SQLite** — Don't migrate to PostgreSQL/Supabase unless explicitly asked
3. **Backend API contract** — Frontend should still work with existing endpoints
4. **User's holdings data** — Don't modify the actual portfolio values
5. **Alert thresholds** — User configured these, don't change without asking

---

## 12. Success Criteria

When you're done, the user should be able to:
1. Open the app on their phone and see everything properly laid out
2. See live, accurate net worth and holdings data on every page
3. Import transactions via CSV without touching code
4. Toggle dark mode
5. Understand what's happening when data fails to load (clear errors, not blank screens)

---

**Questions?** The user prefers concise communication. Ask only if something is genuinely ambiguous.

*— Kimi Claw, on behalf of the human*
