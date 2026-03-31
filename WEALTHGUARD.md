# WEALTHGUARD SYSTEM CONFIGURATION

## Core Mission
- Monitor financial portfolio via local SQLite database
- Execute scheduled financial intelligence tasks
- Maintain data sovereignty - NO third-party bank aggregators
- Alert on risks, opportunities, and geopolitical events affecting holdings

## Operational Protocol
1. Always check memory before analysis
2. Use tables for data, bullets for insights
3. Flag uncertainty explicitly
4. Bold risk warnings
5. Lead with actionable conclusions

## Configuration Status

| Component | Status | Notes |
|-----------|--------|-------|
| SQLite Database | ✅ READY | wealthguard.db initialized |
| portfolio-watcher | ✅ READY | Stock/crypto monitoring active |
| market-news | ✅ READY | Market intelligence active |
| yahoo-data-fetcher | ✅ NATIVE | Using kimi_finance for A-shares |
| Firefly III API | ⏸️ DEFERRED | Local SQLite datastore active |
| dynamic-ui | ✅ NATIVE | Canvas/UI rendering available |

## Database Schema

### accounts
- `id`, `name`, `type` (checking/savings/investment/credit/loan)
- `currency`, `institution`, `current_balance`
- `credit_limit`, `opened_date`, `is_active`

### transactions  
- `id`, `account_id`, `transaction_date`, `posted_date`
- `payee`, `amount`, `currency`, `category`, `subcategory`
- `tags`, `description`, `transaction_type`, `is_recurring`

### holdings
- `id`, `account_id`, `symbol`, `asset_name`, `shares`
- `cost_basis_per_share`, `current_price`, `last_price_update`
- `asset_class`, `sector`, `geography`, `target_allocation_percent`

### budgets
- `id`, `category`, `subcategory`, `budget_amount`, `period`
- `rollover_type`, `rollover_max`, `alert_threshold_percent`

### net_worth_history
- `id`, `snapshot_date`, `total_assets`, `total_liabilities`, `net_worth`
- `investment_value`, `cash_value`, `debt_value`

### alerts
- `id`, `alert_type`, `severity`, `message`, `related_account`
- `triggered_at`, `acknowledged_at`, `dismissed`

## Data Sovereignty
- NO bank aggregators (Plaid, Yodlee, etc.)
- NO third-party financial data APIs with tracking
- ✅ Local SQLite database (wealthguard.db)
- ⏸️ Firefly III integration (deferred)
- Yahoo Finance data via native tools

## Alert Configuration
- **Risk Thresholds**: >5% daily drop, >10% weekly drop
- **Opportunity Flags**: >3% daily gain, volume spike >200%
- **Geopolitical**: Major news affecting sectors in portfolio

## Utilities Available

### wealthguard_utils.py
Located at `/root/.openclaw/workspace/wealthguard_utils.py`

**Functions:**
- `import_csv_transactions(file_path, account_name, date_format=None)` — Smart CSV import with auto-categorization
- `auto_categorize(payee)` — Pattern-based merchant categorization
- `get_account_summary(account_name=None)` — Account balances and activity
- `get_spending_by_category(days=30)` — Spending breakdown analysis
- `add_holding(account_name, symbol, shares, cost_basis, ...)` — Add stock/crypto holdings
- `get_portfolio_summary()` — Complete portfolio with P&L tracking

## Next Steps
1. Import transaction CSV files using `wealthguard_utils.py`
2. Add investment holdings via `add_holding()`
3. Set up budgets and alerts
4. Set up scheduled monitoring cron jobs
5. Configure alert channels
