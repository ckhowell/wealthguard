#!/bin/bash
# PodBits Auto-Ingestion Script
# Runs daily to check for new podcast episodes

LOG_FILE="/tmp/podbits_cron.log"
API_BASE="http://localhost:8000/api/podbits"

echo "[$(date)] Starting PodBits auto-ingestion..." >> "$LOG_FILE"

# Ingest all sources (10 episodes per source max for daily sweep)
curl -s -X POST "${API_BASE}/ingest?max_per_source=10" >> "$LOG_FILE" 2>&1

echo "[$(date)] Ingestion complete" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"
