#!/bin/bash
# WealthGuard Price Sync - Uses yfinance (reliable)

LOG_FILE="/tmp/wealthguard_cron.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$TIMESTAMP] Starting price sync..." >> $LOG_FILE

cd /root/.openclaw/workspace
python3 sync_prices.py >> $LOG_FILE 2>&1

echo "[$TIMESTAMP] Sync finished" >> $LOG_FILE
