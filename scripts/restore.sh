#!/bin/bash
set -euo pipefail

# CommerceFlow OS — SQLite restore script
# Saramantha §13 — DR / restore strategy.
#
# Usage:
#   ./scripts/restore.sh backups/ziay_20260101_120000.db.gz
#
# Behavior:
#   - Saves a copy of the current DB to $DB_PATH.pre-restore.<ts> before
#     overwriting it (safety net).
#   - Gunzips the backup into $DB_PATH.
#
# Env:
#   DATABASE_URL — SQLite path in the form `file:./db/custom.db`

BACKUP_FILE="$1"
DB_PATH="${DATABASE_URL:-file:./db/custom.db}"
DB_PATH="${DB_PATH#file:}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup_file.gz>"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: backup file not found: $BACKUP_FILE"
  exit 1
fi

# Safety net: snapshot the current DB before overwriting.
if [ -f "$DB_PATH" ]; then
  cp "$DB_PATH" "${DB_PATH}.pre-restore.$(date +%Y%m%d_%H%M%S)"
fi

gunzip -c "$BACKUP_FILE" > "$DB_PATH"
echo "[$(date)] Restore complete. DB restored from $BACKUP_FILE → $DB_PATH"
