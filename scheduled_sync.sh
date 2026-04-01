#!/bin/bash
# WealthGuard Scheduled Price Sync
# Respects API rate limits

LOG_FILE="/tmp/wealthguard_cron.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$TIMESTAMP] Starting scheduled sync..." >> $LOG_FILE

cd /root/.openclaw/workspace

# Run the sync
python3 wealthguard_data_sync.py >> $LOG_FILE 2>&1

# Check if it worked
if [ $? -eq 0 ]; then
    echo "[$TIMESTAMP] Sync completed successfully" >> $LOG_FILE
else
    echo "[$TIMESTAMP] Sync failed with exit code $?" >> $LOG_FILE
fi
