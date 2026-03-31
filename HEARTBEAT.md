# HEARTBEAT.md - WealthGuard Development Updates

## Scheduled Task: Send Telegram Update Every 30 Minutes

### Action
Send a summary of recent WealthGuard development progress to Telegram every 30 minutes.

### Telegram Configuration
- Bot: @chruzzbot
- Chat ID: 8504580841
- Token: Stored in .env.telegram (excluded from git)

### Steps
1. Run `/root/.openclaw/workspace/scripts/telegram_update.sh`
2. Script collects:
   - TypeScript file count
   - Total lines of code
   - Recent git commits
   - Brisbane time
3. Sends formatted message via Telegram Bot API

### Update Schedule
- Every 30 minutes
- Timezone: Brisbane AEST (UTC+10)

### Manual Trigger
```bash
/root/.openclaw/workspace/scripts/telegram_update.sh
```

### Last Update Time
Tracked automatically via script execution.
