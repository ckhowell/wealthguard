#!/bin/bash
# WealthGuard Telegram Update Script - FIXED VERSION
# Only sends updates when there's actual new activity

BOT_TOKEN="8333759366:AAGyK5X2W1Iq6jb0DVqgaxdZUriJG35fDG4"
CHAT_ID="8504580841"
LOCK_FILE="/tmp/telegram_update.lock"
LAST_UPDATE_FILE="/tmp/telegram_last_update.txt"

cd /root/.openclaw/workspace

# Prevent duplicate concurrent runs
if [ -f "$LOCK_FILE" ]; then
    LOCK_AGE=$(($(date +%s) - $(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo 0)))
    if [ "$LOCK_AGE" -lt 300 ]; then
        echo "Update already in progress (lock file exists)"
        exit 0
    fi
fi
touch "$LOCK_FILE"

# Cleanup lock on exit
trap "rm -f $LOCK_FILE" EXIT

# Check if we should send an update (only if commits since last update)
if [ -f "$LAST_UPDATE_FILE" ]; then
    LAST_UPDATE=$(cat "$LAST_UPDATE_FILE")
    NEW_COMMITS=$(git log --oneline --since="$LAST_UPDATE" 2>/dev/null)
else
    NEW_COMMITS=$(git log --oneline -3 2>/dev/null)
fi

# Also check for uncommitted changes
UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l)

# If no new commits AND no uncommitted changes, skip the update
if [ -z "$NEW_COMMITS" ] && [ "$UNCOMMITTED" -eq 0 ]; then
    echo "No new activity since last update. Skipping Telegram notification."
    exit 0
fi

# Get stats
FRONTEND_FILE_COUNT=$(find wealthguard-web/src -type f \( -name "*.tsx" -o -name "*.ts" \) 2>/dev/null | wc -l)
FRONTEND_LINE_COUNT=$(find wealthguard-web/src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
BACKEND_FILE_COUNT=$(ls -1 *.py 2>/dev/null | wc -l)
BACKEND_LINE_COUNT=$(cat *.py 2>/dev/null | wc -l)

# Get recent commits (last 24 hours only)
RECENT_COMMITS=$(git log --oneline --since="24 hours ago" 2>/dev/null)
if [ -z "$RECENT_COMMITS" ]; then
    COMMIT_MSG="_No commits in last 24 hours_"
else
    COMMIT_MSG="\`\`\`
${RECENT_COMMITS}
\`\`\`"
fi

# Check for uncommitted changes
if [ "$UNCOMMITTED" -gt 0 ]; then
    GIT_STATUS="⚠️ ${UNCOMMITTED} uncommitted changes"
else
    GIT_STATUS="✅ All changes committed"
fi

# Get Brisbane time
BRISBANE_TIME=$(TZ=Australia/Brisbane date '+%I:%M %p')

# Get current Cloudflare tunnel URL - verify it's recent (not older than 2 hours)
CLOUDFLARE_URL=""
if [ -f "/tmp/cloudflare.log" ]; then
    LOG_AGE=$(($(date +%s) - $(stat -c %Y "/tmp/cloudflare.log" 2>/dev/null || echo 0)))
    if [ "$LOG_AGE" -lt 7200 ]; then
        CLOUDFLARE_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cloudflare.log 2>/dev/null | tail -1)
    fi
fi

if [ -z "$CLOUDFLARE_URL" ]; then
    CLOUDFLARE_URL="⚠️ Tunnel not running (check manually)"
fi

# Build message - MORE CONCISE
MESSAGE="🔄 **WealthGuard Update** ${BRISBANE_TIME} AEST

📊 **Code:** ${FRONTEND_FILE_COUNT} TS files · ${BACKEND_FILE_COUNT} Python modules

📝 **Recent Commits (24h):**
${COMMIT_MSG}

${GIT_STATUS}

🌐 **Live:** ${CLOUDFLARE_URL}

---
_Automated update · Only sent when there's new activity_"

# Send via Telegram
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}" \
  -d "text=${MESSAGE}" \
  -d "parse_mode=Markdown" > /dev/null 2>&1

# Record this update time
date -Iseconds > "$LAST_UPDATE_FILE"

echo "Update sent at $(date) (activity detected)"
