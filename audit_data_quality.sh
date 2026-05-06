#!/bin/bash
# WealthGuard Data Quality Audit — 10 checks
# Run with: bash audit_data_quality.sh

DB="/Users/christopherhowell/WealthGuard/wealthguard_source/wealthguard.db"
API="http://localhost:8000"

echo "# WealthGuard Data Quality Audit"
echo "Generated: $(date)"
echo ""

# Check 1: Stale prices
echo "## Check 1: Stale prices (>48h old or NULL)"
sqlite3 "$DB" "SELECT symbol, current_price, last_price_update FROM holdings WHERE asset_class IN ('equity','etf','crypto') AND (last_price_update IS NULL OR datetime(last_price_update) < datetime('now','-48 hours'));" > /tmp/check1.txt
COUNT=$(wc -l < /tmp/check1.txt)
if [ "$COUNT" -gt 0 ]; then
  echo "**FOUND:** $COUNT rows"
  cat /tmp/check1.txt
else
  echo "✓ All prices current"
fi
echo ""

# Check 2: Transactions in "Other Expenses"
echo "## Check 2: Transactions categorized as 'Other Expenses'"
sqlite3 "$DB" "SELECT import_source, COUNT(*) as count FROM transactions WHERE category='Other Expenses' GROUP BY import_source;" > /tmp/check2.txt
COUNT=$(wc -l < /tmp/check2.txt)
if [ "$COUNT" -gt 0 ]; then
  echo "**FOUND:**"
  cat /tmp/check2.txt
else
  echo "✓ No 'Other Expenses' transactions"
fi
echo ""

# Check 3: Orphan transactions
echo "## Check 3: Orphan transactions (account_id NULL or deleted)"
ORPHANS=$(sqlite3 "$DB" "SELECT COUNT(*) FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE a.id IS NULL;")
echo "Orphan count: $ORPHANS"
if [ "$ORPHANS" -gt 0 ]; then
  echo "**HIGH SEVERITY**"
  sqlite3 "$DB" "SELECT t.id, t.account_id, t.transaction_date, t.payee, t.amount FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE a.id IS NULL LIMIT 20;"
fi
echo ""

# Check 4: Currency mismatch
echo "## Check 4: Currency mismatch (holding native_currency != account currency)"
sqlite3 "$DB" "SELECT h.id, h.symbol, h.native_currency, a.name, a.currency FROM holdings h LEFT JOIN accounts a ON h.account_id=a.id WHERE h.native_currency IS NOT NULL AND a.currency IS NOT NULL AND h.native_currency != a.currency;" > /tmp/check4.txt
COUNT=$(wc -l < /tmp/check4.txt)
if [ "$COUNT" -gt 0 ]; then
  echo "**FOUND:** $COUNT mismatches"
  cat /tmp/check4.txt
else
  echo "✓ No currency mismatches"
fi
echo ""

# Check 5: Renovation-like transactions without project_id
echo "## Check 5: Renovation-like payees without project_id"
sqlite3 "$DB" "SELECT COUNT(*) as count, GROUP_CONCAT(DISTINCT SUBSTR(payee, 1, 30), '; ') as sample_payees FROM transactions WHERE (payee LIKE '%BUNNINGS%' OR payee LIKE '%HOME TIMBER%' OR payee LIKE '%SYDNEY TOOLS%' OR payee LIKE '%BEACON LIGHTING%' OR payee LIKE '%THE GOOD GUYS%' OR payee LIKE '%TANKTEC%' OR payee LIKE '%HARVEY NORMAN%') AND project_id IS NULL;" > /tmp/check5.txt
cat /tmp/check5.txt
echo ""

# Check 6: Duplicate transactions
echo "## Check 6: Duplicate transactions (same account/date/amount/payee)"
sqlite3 "$DB" "SELECT account_id, transaction_date, amount, payee, COUNT(*) as cnt FROM transactions GROUP BY account_id, transaction_date, amount, payee HAVING COUNT(*) > 1;" > /tmp/check6.txt
COUNT=$(wc -l < /tmp/check6.txt)
if [ "$COUNT" -gt 0 ]; then
  echo "**FOUND:** $COUNT duplicate sets"
  cat /tmp/check6.txt
else
  echo "✓ No duplicates detected"
fi
echo ""

# Check 7: Savings accounts with no APY
echo "## Check 7: Savings accounts (balance >$1000) with no APY"
sqlite3 "$DB" "SELECT id, name, balance, apy FROM accounts WHERE account_type='savings' AND balance > 1000 AND (apy IS NULL OR apy = 0);" > /tmp/check7.txt
COUNT=$(wc -l < /tmp/check7.txt)
if [ "$COUNT" -gt 0 ]; then
  echo "**FOUND:** $COUNT accounts"
  cat /tmp/check7.txt
else
  echo "✓ All savings accounts have APY set"
fi
echo ""

# Check 8: Goals without target_date or past-due
echo "## Check 8: Goals without target_date or past-due/unachieved"
sqlite3 "$DB" "SELECT id, name, target_date, achieved FROM goals WHERE target_date IS NULL OR (datetime(target_date) < datetime('now') AND achieved=0);" > /tmp/check8.txt
COUNT=$(wc -l < /tmp/check8.txt)
if [ "$COUNT" -gt 0 ]; then
  echo "**FOUND:** $COUNT issues"
  cat /tmp/check8.txt
else
  echo "✓ Goals in order"
fi
echo ""

# Check 9: FX rates stale
echo "## Check 9: FX rates stale (>24h old)"
sqlite3 "$DB" "SELECT pair, rate, last_updated FROM fx_rates WHERE datetime(last_updated) < datetime('now','-24 hours') ORDER BY last_updated DESC LIMIT 10;" > /tmp/check9.txt
COUNT=$(wc -l < /tmp/check9.txt)
if [ "$COUNT" -gt 0 ]; then
  echo "**FOUND:** $COUNT stale rates"
  cat /tmp/check9.txt
else
  echo "✓ FX rates current"
fi
echo ""

# Check 10: Wealth plan blanks
echo "## Check 10: Wealth plan completeness (via /api/plan)"
echo "Checking API at $API..."
curl -s "$API/api/plan" 2>/dev/null | python3 -m json.tool > /tmp/check10.json
if [ -s /tmp/check10.json ]; then
  echo "Plan data retrieved. Checking for NULLs..."
  python3 << 'PYEOF'
import json
with open('/tmp/check10.json') as f:
    plan = json.load(f)

required = [
    'nicole_income_monthly',
    'acacia_reno_cost',
    'acacia_sale_target',
    'lind_build_cost',
    'lind_sale_target',
    'retirement_year'
]

missing = {k: plan.get(k) for k in required if plan.get(k) is None or plan.get(k) == ''}
if missing:
    print(f"**FOUND:** {len(missing)} missing fields")
    for k, v in missing.items():
        print(f"  - {k}: {v}")
else:
    print("✓ All plan fields populated")
PYEOF
else
  echo "**ERROR:** Could not reach API at $API"
fi
echo ""

echo "---"
echo "Audit complete. Review findings above."
