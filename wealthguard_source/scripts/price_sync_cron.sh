#!/bin/bash
# Price sync cron wrapper — runs sync_prices.py via the project venv + logs.
LOG=/tmp/wealthguard_price_sync.log
echo "[$(date)] price-sync start" >> "$LOG"
/Users/christopherhowell/WealthGuard/wealthguard_source/.venv/bin/python \
  /Users/christopherhowell/WealthGuard/wealthguard_source/sync_prices.py \
  >> "$LOG" 2>&1
echo "[$(date)] price-sync end" >> "$LOG"
echo "---" >> "$LOG"
