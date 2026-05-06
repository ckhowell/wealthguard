---
type: note
created: 2026-04-05
tags: [note, personal]
---

# WealthGuard Hardcoded Values Audit Report

## Table of Contents

- [[#🔴 CRITICAL - Hardcoded Financial Data]]
- [[#🟡 HIGH - Mock Data/Fallback Values]]
- [[#🟢 LOW - Static Configuration]]
- [[#📊 Summary by Severity]]
- [[#🛠️ Recommended Fixes]]
- [[#✅ Already Fixed Today]]

**Generated:** April 5, 2026
**Scope:** Full codebase scan for hardcoded numeric values that should use live data

---

## 🔴 CRITICAL - Hardcoded Financial Data

### 1. FX Rates (USD/AUD) - HARDCODED IN 7+ LOCATIONS
**Status:** ⚠️ Should fetch from live API (XE, Fixer.io, or Yahoo Finance)

| Location | Hardcoded Value | Should Be |
|----------|-----------------|-----------|
| `wealthguard-web/src/services/priceService.ts:170` | `1.447` | Live FX API |
| `wealthguard-web/src/services/priceServiceEnhanced.ts:158` | `1.447` | Live FX API |
| `wealthguard-web/src/pages/Advisor.tsx:1272` | `1.447` | Live FX API |
| `wealthguard-web/src/pages/Dashboard.tsx:130` | `1.447` | Live FX API |
| `wealthguard-web/src/pages/Portfolio.tsx:15` | `1.447` | Live FX API |
| `wealthguard_api.py:277` | `1.447` | Live FX API |
| `sync_prices.py:19` | `1.447` | Live FX API |

**Impact:** All USD→AUD conversions use stale rate

---

### 2. JPY/AUD Exchange Rate - HARDCODED
**Status:** ⚠️ Multiple hardcoded instances

| Location | Hardcoded Value | Should Be |
|----------|-----------------|-----------|
| `wealthguard_utils.py:586` | `0.009117` | Live FX API |
| `wealthguard_dashboard.py:104` | `0.009117` | Live FX API |
| `scripts/daily_net_worth.py:35` | `0.009117` | Live FX API |
| `sync_prices.py:18` | `0.009117` | Live FX API |
| `wealthguard_api.py:276-287` | Multiple rates | Live FX API |

---

### 3. Net Worth Value - HARDCODED
**Status:** 🔴 Should fetch from database

| Location | Hardcoded Value | Should Be |
|----------|-----------------|-----------|
| `wealthguard-web/src/App.tsx:32` | `$3,828,255.31` | Live calculation from DB |
| `wealthguard-web/src/pages/Dashboard.tsx:39` | `3828255` | Live calculation from DB |

---

## 🟡 HIGH - Mock Data/Fallback Values

### 4. Mock Stock Prices in Markets.tsx
**Status:** ⚠️ Fallback mock data when API fails

**File:** `wealthguard-web/src/pages/Markets.tsx:168-212`

```typescript
// These are FALLBACK mock prices used when API is down:
{ symbol: 'AAPL', price: 225.50 },    // Currently LIVE: $255.92
{ symbol: 'MSFT', price: 420.80 },    // Currently LIVE: $373.46
{ symbol: 'NVDA', price: 138.20 },    // Currently LIVE: $177.39
{ symbol: 'GOOGL', price: 178.90 },   // Currently LIVE: $295.77
{ symbol: 'AMZN', price: 198.40 },    // Currently LIVE: $209.77
{ symbol: 'META', price: 595.20 },    // Currently LIVE: $574.46
{ symbol: 'TSLA', price: 268.30 },    // Currently LIVE: $360.59
{ symbol: 'BTC', price: 87500.00 },   // Currently LIVE: ~$83,000
{ symbol: 'ETH', price: 3250.00 },    // Currently LIVE: ~$1,800
{ symbol: 'SOL', price: 145.20 },     // Currently LIVE: ~$130
```

**Impact:** Users see stale prices if API fails

---

### 5. A-Share (China) Stock Data - GENERATED MOCK
**Status:** 🔴 Completely mock data

**File:** `wealthguard-web/src/pages/AShare.tsx`

- **Lines 13-80:** Hardcoded stock list with static market cap values
- **Lines 117-141:** `generateMockQuote()` creates random prices
- **Lines 199-202:** All A-Share prices are computer-generated, not real

**Example hardcoded market caps:**
```typescript
{ symbol: '600519', name: '贵州茅台', marketCap: 2100 }, // Hardcoded
{ symbol: '601318', name: '中国平安', marketCap: 850 },  // Hardcoded
```

**Impact:** A-Share page shows completely fictional prices

---

### 6. Transaction Data - MOCK
**Status:** ⚠️ Demo/sample data

**File:** `wealthguard-web/src/pages/Transactions.tsx:6-10`

```typescript
// Mock transaction data
{ id: 1, date: '2026-03-28', amount: 2084.52, ... }
{ id: 3, date: '2026-03-25', amount: 5000.00, ... }
{ id: 5, date: '2026-03-23', amount: 2500.00, ... }
```

**Impact:** Transaction history shows fake/demo data

---

### 7. Performance Chart Data - MOCK
**Status:** ⚠️ Generated data

**File:** `wealthguard-web/src/pages/Performance.tsx:20-40`

```typescript
// Generate mock historical performance data
// Monthly returns (mock data)
```

**Impact:** Performance charts show fictional historical data

---

## 🟢 LOW - Static Configuration

### 8. Telegram Credentials - HARDCODED
**File:** `wealthguard_telegram.py:16-17`

```python
BOT_TOKEN = "8333759366:AAGyK5X2W1Iq6jb0DVqgaxdZUriJG35fDG4"
CHAT_ID = "8504580841"
```

**Impact:** Security risk - should use environment variables

---

## 📊 Summary by Severity

| Severity | Count | Category |
|----------|-------|----------|
| 🔴 Critical | 3 | FX Rates, Net Worth, A-Share Data |
| 🟡 High | 4 | Mock stock prices, Mock transactions, Mock performance |
| 🟢 Low | 1 | Credentials hardcoded |

---

## 🛠️ Recommended Fixes

### Priority 1: Live FX Rates
```python
# Add to wealthguard_api.py
def get_live_fx_rate(from_currency: str, to_currency: str):
    """Fetch live FX rate from Yahoo Finance or similar"""
    # Use yfinance to get ^AUDUSD=X or similar
```

### Priority 2: Live A-Share Prices
- Integrate with Sina Finance API or similar for China stocks
- Replace `generateMockQuote()` with real API calls

### Priority 3: Remove Mock Fallbacks
- Either remove mock data entirely (show error) or
- Add prominent "OFFLINE MODE" banner when showing stale data

### Priority 4: Environment Variables
- Move Telegram credentials to `.env` file
- Add validation to ensure production uses live data

---

## ✅ Already Fixed Today

- ✅ Market indices (S&P 500, Dow Jones, etc.) - Now live via Yahoo Finance

---

*End of Audit Report*
