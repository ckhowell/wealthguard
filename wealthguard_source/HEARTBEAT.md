---
type: note
created: 2026-04-08
tags: [note, personal]
---

# HEARTBEAT.md - WealthGuard Autonomous Operations

## Table of Contents

- [[#DO NOT JUST CHECK - ACTUALLY DO THINGS]]
- [[#TELEGRAM POLICY (UPDATED - NO MORE SPAM)]]
- [[#IMMEDIATE ACTIONS FOR THIS HEARTBEAT]]
- [[#MANUAL COMMANDS]]
- [[#REMEMBER]]


## DO NOT JUST CHECK - ACTUALLY DO THINGS

Every heartbeat, you MUST do at least ONE of the following:

### 1. Price Sync Check ⭐ PRIORITY
- Check if backend API is running (`curl http://localhost:8000/`)
- If NOT running: start it with `./start_backend.sh`
- If running: check if prices are stale (> 10 minutes old)
- If stale: trigger manual sync via API

### 2. Portfolio Health Check
- Query `/api/portfolio/summary`
- If total_value drops > 5%: alert user
- Check for any holdings without price updates (> 24 hours)

### 3. Log Cleanup
- Archive old logs from `/tmp/wealthguard_*.log`
- Delete logs older than 7 days

### 4. Memory Update
- Review today's `memory/YYYY-MM-DD.md`
- Update `MEMORY.md` with important decisions
- Document any issues encountered

---

## TELEGRAM POLICY (UPDATED - NO MORE SPAM)

**DON'T send automatic Telegram updates.**

The user complained about "hallucinations" - too many messages with:
- Stale/incorrect Cloudflare URLs
- Duplicate price alerts
- Updates when nothing changed

**Only send Telegram messages when:**
1. User explicitly asks for an update
2. Critical system failure (backend down > 30 min)
3. Major price movement (> 10% in single check)
4. You complete a significant feature the user requested

**To send manual update:**
```bash
/root/.openclaw/workspace/scripts/telegram_update.sh
```

**The script now only sends if there's actual new activity.**

---

## IMMEDIATE ACTIONS FOR THIS HEARTBEAT

**Current Status Check:**
- [ ] Backend API running?
- [ ] Prices fresh (last 10 min)?
- [ ] Any critical issues?

**Active Work Items:**
1. Monitor price sync
2. Keep systems running
3. Wait for Gemini quota reset (tomorrow)

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

---

## REMEMBER

**You are WealthGuard's autonomous operator.**
Don't wait for permission. Don't ask "should I?" Just DO.

**But be smart about it:**
- If backend is down → Start it.
- If prices are stale → Sync them.
- If something broke → Fix it.
- **DON'T spam Telegram with routine updates**

**BE USEFUL WITHOUT BEING ANNOYING.**
