#!/bin/bash
# WealthGuard Backend Service Launcher
# Starts the API server and data sync scheduler

cd /root/.openclaw/workspace

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting WealthGuard Backend Services...${NC}"

# Check if Python dependencies are installed
echo -e "${YELLOW}Checking dependencies...${NC}"
pip3 install -q -r requirements.txt 2>/dev/null || {
    echo -e "${RED}Failed to install dependencies. Run: pip3 install -r requirements.txt${NC}"
    exit 1
}

# Create price_history table if not exists
echo -e "${YELLOW}Initializing database...${NC}"
python3 -c "
import sqlite3
import os
DB_PATH = os.getenv('DATABASE_PATH', '/root/.openclaw/workspace/wealthguard.db')
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute('''
    CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        price REAL NOT NULL,
        currency TEXT,
        source TEXT,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
''')
cursor.execute('CREATE INDEX IF NOT EXISTS idx_price_history_symbol ON price_history(symbol)')
cursor.execute('CREATE INDEX IF NOT EXISTS idx_price_history_time ON price_history(recorded_at)')
conn.commit()
conn.close()
print('Database initialized')
"

# Start the API server in background
echo -e "${GREEN}Starting API server on http://0.0.0.0:8000${NC}"
python3 wealthguard_api.py > /tmp/wealthguard_api.log 2>&1 &
API_PID=$!
echo $API_PID > /tmp/wealthguard_api.pid
echo -e "${GREEN}API server started (PID: $API_PID)${NC}"

# Wait a moment for API to start
sleep 2

# Run initial price sync
echo -e "${YELLOW}Running initial price sync...${NC}"
python3 wealthguard_data_sync.py 2>&1 | tee /tmp/wealthguard_sync.log

# Set up cron-like scheduling for periodic sync
echo -e "${YELLOW}Setting up scheduled sync (every 5 minutes)...${NC}"
(
    while true; do
        sleep 300  # 5 minutes
        echo "[$(date)] Running scheduled sync..." >> /tmp/wealthguard_scheduler.log
        python3 /root/.openclaw/workspace/wealthguard_data_sync.py >> /tmp/wealthguard_sync.log 2>&1
    done
) &
SCHEDULER_PID=$!
echo $SCHEDULER_PID > /tmp/wealthguard_scheduler.pid
echo -e "${GREEN}Scheduler started (PID: $SCHEDULER_PID)${NC}"

echo ""
echo -e "${GREEN}✅ WealthGuard Backend is running!${NC}"
echo ""
echo "API Endpoint: http://localhost:8000"
echo "API Docs:     http://localhost:8000/docs"
echo "Logs:         tail -f /tmp/wealthguard_api.log"
echo "Sync Logs:    tail -f /tmp/wealthguard_sync.log"
echo ""
echo "To stop:      kill \$(cat /tmp/wealthguard_api.pid) \$(cat /tmp/wealthguard_scheduler.pid)"
