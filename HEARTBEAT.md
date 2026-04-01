# HEARTBEAT.md - WealthGuard Autonomous Operations

## DO NOT JUST CHECK - ACTUALLY DO THINGS

Every heartbeat, you MUST do at least ONE of the following:

### 1. Price Sync Check
- Check if backend API is running (`curl http://localhost:8000/`)
- If NOT running: start it with `./start_backend.sh`
- If running: check if prices are stale (> 10 minutes old)
- If stale: trigger manual sync via API

### 2. Telegram Update
- Send development progress to Telegram every 30 minutes
- Script: `/root/.openclaw/workspace/scripts/telegram_update.sh`
- Include: code stats, commit history, live URL

### 3. Portfolio Health Check
- Query `/api/portfolio/summary`
- If total_value drops > 5%: alert user
- Check for any holdings without price updates (> 24 hours)

### 4. Log Cleanup
- Archive old logs from `/tmp/wealthguard_*.log`
- Delete logs older than 7 days

### 5. Memory Update
- Review today's `memory/YYYY-MM-DD.md`
- Update `MEMORY.md` with important decisions
- Document any issues encountered

---

## IMMEDIATE ACTIONS FOR THIS HEARTBEAT

**Current Status Check:**
- [ ] Backend API running?
- [ ] Prices fresh (last 10 min)?
- [ ] Telegram update needed?

**Active Work Items:**
1. Finish WealthGuard live data integration
2. Get API key for stock prices (Finnhub)
3. Test full end-to-end flow

---

## MANUAL COMMANDS

Start everything:
```bash
cd /root/.openclaw/workspace
./start_backend.sh
cd wealthguard-web && npm run dev
```

Check API:
```bash
curl http://localhost:8000/
curl http://localhost:8000/api/portfolio/summary
```

Trigger sync:
```bash
curl -X POST http://localhost:8000/api/sync/prices
```

Send Telegram update:
```bash
/root/.openclaw/workspace/scripts/telegram_update.sh
```

---

## REMEMBER

**You are WealthGuard's autonomous operator.**
Don't wait for permission. Don't ask "should I?" Just DO.

If the backend is down → Start it.
If prices are stale → Sync them.
If 30 minutes passed → Send update.
If something broke → Fix it or document it.

**BE USEFUL WITHOUT BEING ASKED.**
