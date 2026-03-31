#!/bin/bash
# WealthGuard Telegram Update Script
# Sends development progress updates every 30 minutes

BOT_TOKEN="8333759366:AAGyK5X2W1Iq6jb0DVqgaxdZUriJG35fDG4"
CHAT_ID="8504580841"

cd /root/.openclaw/workspace

# Get stats
FILE_COUNT=$(find wealthguard-web/src -type f \( -name "*.tsx" -o -name "*.ts" \) 2>/dev/null | wc -l)
LINE_COUNT=$(find wealthguard-web/src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')

# Get recent commits
COMMITS=$(git log --oneline -5 2>/dev/null | head -5)

# Get Brisbane time
BRISBANE_TIME=$(TZ=Australia/Brisbane date '+%I:%M %p')

# Build message
MESSAGE="🔄 **WealthGuard Update** ${BRISBANE_TIME} AEST

📊 **Stats:**
• ${FILE_COUNT} TypeScript files
• ${LINE_COUNT} lines of code

📝 **Recent Commits:**
${COMMITS}

🌐 **Live:** https://given-ethics-part-gauge.trycloudflare.com

---
Next update in 30 mins ⏱️"

# Send via Telegram
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}" \
  -d "text=${MESSAGE}" \
  -d "parse_mode=Markdown" > /dev/null 2>&1

echo "Update sent at $(date)"
