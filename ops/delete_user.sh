#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${DB_PATH:-app/data.sqlite}"

usage() {
  echo "Usage: $0 <email>"
  echo "Environment: DB_PATH=${DB_PATH} (override with env var)"
  exit 1
}

command -v sqlite3 >/dev/null 2>&1 || {
  echo "Error: sqlite3 not found. Install it or rebuild the dev container." >&2
  exit 1
}

[[ $# -eq 1 ]] || usage
EMAIL="$1"

# Escape single quotes for SQLite
EMAIL_ESCAPED="${EMAIL//\'/''}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "Error: database not found at $DB_PATH" >&2
  exit 1
fi

USER_ID="$(sqlite3 "$DB_PATH" "SELECT id FROM users WHERE email = '$EMAIL_ESCAPED' LIMIT 1;")"

if [[ -z "$USER_ID" ]]; then
  echo "No user found with email: $EMAIL"
  exit 0
fi

echo "Deleting user id=$USER_ID email=$EMAIL from $DB_PATH ..."

# Use a single transaction; delete user first (trips + cities cascade), then cleanup others
sqlite3 "$DB_PATH" <<SQL
PRAGMA foreign_keys = ON;
BEGIN;
DELETE FROM users    WHERE id = $USER_ID;
DELETE FROM trips    WHERE user_id = $USER_ID;   -- no-op if cascaded
DELETE FROM sessions WHERE user_id = $USER_ID;
COMMIT;
SQL

echo "Done."