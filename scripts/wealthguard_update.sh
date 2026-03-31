#!/bin/bash

# WealthGuard Development Update Script
# Generates a summary of recent commits and sends via Telegram

cd /root/.openclaw/workspace

# Get recent commits
COMMITS=$(git log --oneline -10)

# Get file stats
FILE_COUNT=$(find wealthguard-web/src -type f \( -name "*.tsx" -o -name "*.ts" \) | wc -l)
LINE_COUNT=$(find wealthguard-web/src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec wc -l {} + | tail -1 | awk '{print $1}')

# Create message
MESSAGE="🔄 **WealthGuard Update** $(date '+%H:%M')

📊 **Stats:**
• $FILE_COUNT TypeScript files
• $LINE_COUNT lines of code

📝 **Recent Commits:**
$COMMITS

🌐 **Live:** https://given-ethics-part-gauge.trycloudflare.com

---
Built with ❤️ by Kimi Claw"

echo "$MESSAGE"
