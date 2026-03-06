#!/bin/bash

# Skills.sh Data Sync Script
# Run this script periodically (e.g., via cron) to keep skills data updated

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_FILE="${SCRIPT_DIR}/../skills_sh_data.json"
LOG_FILE="${SCRIPT_DIR}/../sync.log"

# Log function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Starting skills.sh sync..."

# Run the scraper
cd "$SCRIPT_DIR/.."

# Build if needed
if [ ! -f "./scraper" ]; then
    log "Building scraper..."
    go build -o scraper ./cmd/scraper
fi

# Run scraper
log "Running scraper..."
./scraper -output "$OUTPUT_FILE" -verbose

# Sync with API server (if running)
API_URL="${API_URL:-http://localhost:3101}"
log "Syncing with API server at $API_URL..."

RESPONSE=$(curl -s -X POST "$API_URL/api/sync" 2>&1 || echo "Failed to connect to API server")

if echo "$RESPONSE" | grep -q '"status":"success"'; then
    log "API sync successful"
else
    log "Warning: API sync may have failed: $RESPONSE"
fi

log "Sync complete!"