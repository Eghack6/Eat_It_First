#!/usr/bin/env bash
set -euo pipefail

DB_FILE="${DATABASE_FILE:-/var/lib/eat-it-first/eat-it-first.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/eat-it-first}"
KEEP="${KEEP_BACKUPS:-14}"

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/eat-it-first-$timestamp.db"

sqlite3 "$DB_FILE" ".backup '$backup_file'"
find "$BACKUP_DIR" -type f -name 'eat-it-first-*.db' -printf '%T@ %p\n' \
  | sort -nr | tail -n +$((KEEP + 1)) | cut -d' ' -f2- \
  | xargs -r rm -f

echo "Created $backup_file"
