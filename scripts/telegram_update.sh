#!/bin/bash
# WealthGuard Telegram Update Script
# Sends development progress updates every 30 minutes

BOT_TOKEN="8333759366:AAGyK5X2W1Iq6jb0DVqgaxdZUriJG35fDG4"
CHAT_ID="8504580841"

cd /root/.openclaw/workspace

# Get stats
FRONTEND_FILE_COUNT=$(find wealthguard-web/src -type f \( -name "*.tsx" -o -name "*.ts" \) 2>/dev/null | wc -l)
FRONTEND_LINE_COUNT=$(find wealthguard-web/src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')

# Backend stats
BACKEND_FILE_COUNT=$(ls -1 *.py 2>/dev/null | wc -l)
BACKEND_LINE_COUNT=$(cat *.py 2>/dev/null | wc -l)

# Get recent commits
COMMITS=$(git log --oneline -5 2>/dev/null | head -5)

# Get Brisbane time
BRISBANE_TIME=$(TZ=Australia/Brisbane date '+%I:%M %p')

# Build message
MESSAGE="🔄 **WealthGuard Update** ${BRISBANE_TIME} AEST

📊 **Frontend (React/TS):**
• ${FRONTEND_FILE_COUNT} TypeScript files
• ${FRONTEND_LINE_COUNT} lines of code

⚙️ **Backend (Python):**
• ${BACKEND_FILE_COUNT} Python modules
• ${BACKEND_LINE_COUNT} lines of code

📝 **Recent Commits:**
${COMMITS}

🌐 **Live Dashboard:** https://given-ethics-part-gauge.trycloudflare.com
📡 **API Endpoint:** http://localhost:8000

---
Next update in 30 mins ⏱️"

# Send via Telegram
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}" \
  -d "text=${MESSAGE}" \
  -d "parse_mode=Markdown" > /dev/null 2>&1

echo "Update sent at $(date)"
