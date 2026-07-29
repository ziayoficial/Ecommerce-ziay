#!/bin/bash
set -euo pipefail

# CommerceFlow OS — SQLite backup script
# Saramantha §13 — DR / backup strategy.
#
# Usage:
#   ./scripts/backup.sh
#
# Env:
#   BACKUP_DIR   — destination dir (default: ./backups)
#   DATABASE_URL — SQLite path in the form `file:./db/custom.db`
#
# Output: $BACKUP_DIR/ziay_YYYYMMDD_HHMMSS.db.gz
# Retention: deletes backups older than 30 days.

BACKUP_DIR="${BACKUP_DIR:-./backups}"
DB_PATH="${DATABASE_URL:-file:./db/custom.db}"
DB_PATH="${DB_PATH#file:}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/ziay_$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"
echo "[$(date)] Starting backup..."

# Prefer sqlite3 .backup (online, consistent); fall back to cp if sqlite3 is
# not installed.
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'" 2>/dev/null || cp "$DB_PATH" "$BACKUP_FILE"

gzip "$BACKUP_FILE"
echo "[$(date)] Backup complete: $BACKUP_FILE.gz"

# Retention: delete backups older than 30 days
find "$BACKUP_DIR" -name "ziay_*.db.gz" -mtime +30 -delete 2>/dev/null || true
echo "Done."
