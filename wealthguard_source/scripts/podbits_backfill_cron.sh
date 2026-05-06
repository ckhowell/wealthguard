#!/bin/bash
# PodBits Weekly Deep-Sweep Backfill
# Runs weekly to catch any episodes missed by the daily cron (fast-publishing feeds).

LOG_FILE="/tmp/podbits_backfill.log"
API_BASE="http://localhost:8000/api/podbits"

echo "[$(date)] Starting PodBits weekly backfill..." >> "$LOG_FILE"

# Deep sweep — up to 50 episodes per source.
curl -s -X POST "${API_BASE}/ingest?max_per_source=50" >> "$LOG_FILE" 2>&1

echo "[$(date)] Backfill complete" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"
