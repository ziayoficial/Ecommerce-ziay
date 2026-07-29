#!/bin/bash
set -euo pipefail

# CommerceFlow OS — PostgreSQL backup + restore script.
# SPRINT-MONITORING-DR-001 · M-4 + M-5 — closes two audit gaps:
#   M-4: the previous backup script (scripts/backup.sh) was SQLite-only.
#        This script uses `pg_dump -Fc` (custom format) which is the
#        recommended binary format for PostgreSQL (parallel restore,
#        selective restore, compression built-in).
#   M-5: the previous script wrote to a local dir only. This script also
#        uploads to an S3-compatible bucket (via `aws s3` or `rclone`) when
#        S3_BACKUP_BUCKET is set, and supports at-rest encryption via
#        openssl aes-256-gcm when BACKUP_ENCRYPTION_KEY is set.
#
# Usage:
#   ./scripts/backup-pg.sh                 # backup (default)
#   ./scripts/backup-pg.sh backup          # explicit backup
#   ./scripts/backup-pg.sh restore latest  # restore most recent backup
#   ./scripts/backup-pg.sh restore ziay_pg_20260101_020000.dump
#
# Env:
#   DATABASE_URL             — PostgreSQL connection string (required)
#   BACKUP_DIR               — destination dir (default: ./backups)
#   S3_BACKUP_BUCKET         — offsite bucket (optional). Uses `aws` if
#                              available, falls back to `rclone`.
#   BACKUP_ENCRYPTION_KEY    — passphrase for aes-256-gcm at-rest encryption
#                              (optional, but recommended for offsite copies).
#
# Output:
#   Backup:  $BACKUP_DIR/ziay_pg_YYYYMMDD_HHMMSS.dump[.enc]
#   Restore: pg_restore into DATABASE_URL with --clean --if-exists
# Retention: deletes local backups older than 30 days (after a successful
#            backup). Offsite retention is managed by the bucket lifecycle
#            policy (not by this script).

DB_URL="${DATABASE_URL:?DATABASE_URL must be set}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
S3_BUCKET="${S3_BACKUP_BUCKET:-}"  # optional offsite
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

if [ "${1:-backup}" = "backup" ]; then
  FILENAME="ziay_pg_${TIMESTAMP}.dump"
  FILEPATH="$BACKUP_DIR/$FILENAME"

  echo "Backing up PostgreSQL to $FILEPATH..."
  pg_dump -Fc --no-owner --no-privileges "$DB_URL" -f "$FILEPATH"

  # Encrypt if key is set
  if [ -n "$ENCRYPTION_KEY" ]; then
    openssl enc -aes-256-gcm -salt -pbkdf2 \
      -in "$FILEPATH" -out "$FILEPATH.enc" \
      -pass pass:"$ENCRYPTION_KEY"
    rm "$FILEPATH"
    FILEPATH="$FILEPATH.enc"
    echo "Encrypted backup: $FILEPATH"
  fi

  # Upload to S3 if configured
  if [ -n "$S3_BUCKET" ]; then
    if command -v aws &>/dev/null; then
      aws s3 cp "$FILEPATH" "s3://$S3_BUCKET/$(basename $FILEPATH)"
      echo "Uploaded to S3: s3://$S3_BUCKET/$(basename $FILEPATH)"
    elif command -v rclone &>/dev/null; then
      rclone copy "$FILEPATH" "remote:$S3_BUCKET/"
      echo "Uploaded via rclone: remote:$S3_BUCKET/"
    else
      echo "WARNING: No S3 CLI found (aws/rclone). Backup is local only."
    fi
  fi

  # Retention: keep last 30 days
  find "$BACKUP_DIR" -name "ziay_pg_*.dump*" -mtime +30 -delete

  echo "Backup complete: $FILEPATH"

elif [ "${1:-}" = "restore" ]; then
  FILENAME="${2:-latest}"

  if [ "$FILENAME" = "latest" ]; then
    FILEPATH=$(ls -t "$BACKUP_DIR"/ziay_pg_*.dump* | head -1)
  else
    FILEPATH="$BACKUP_DIR/$FILENAME"
  fi

  if [ ! -f "$FILEPATH" ]; then
    echo "ERROR: Backup file not found: $FILEPATH"
    exit 1
  fi

  # Decrypt if needed
  if [[ "$FILEPATH" == *.enc ]]; then
    if [ -z "$ENCRYPTION_KEY" ]; then
      echo "ERROR: Encrypted backup but BACKUP_ENCRYPTION_KEY not set"
      exit 1
    fi
    DECRYPTED="${FILEPATH%.enc}"
    openssl enc -d -aes-256-gcm -pbkdf2 \
      -in "$FILEPATH" -out "$DECRYPTED" \
      -pass pass:"$ENCRYPTION_KEY"
    FILEPATH="$DECRYPTED"
    TMP_DECRYPTED="$DECRYPTED"
  fi

  echo "Restoring from $FILEPATH..."
  pg_restore -d "$DB_URL" --clean --if-exists --no-owner --no-privileges "$FILEPATH"

  # Cleanup temp decrypted file
  [ -n "${TMP_DECRYPTED:-}" ] && rm "$TMP_DECRYPTED"

  echo "Restore complete"
else
  echo "Usage: $0 [backup|restore <filename>]"
  exit 1
fi
