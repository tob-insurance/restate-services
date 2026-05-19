#!/usr/bin/env bash
#
# psql.sh - psql wrapper with embedded connection
#
# Environment (set once, then forget):
#   PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD, PG_SCHEMA
#
# Usage:
#   ./psql.sh -c "SELECT * FROM users LIMIT 10"
#   ./psql.sh --csv -c "SELECT id, name FROM users"
#   ./psql.sh -f script.sql

set -uo pipefail

# Load .env from skill directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
if [[ -f "$SKILL_DIR/.env" ]]; then
  set -a
  source "$SKILL_DIR/.env"
  set +a
fi

# Verify psql is available
if ! command -v psql &>/dev/null; then
  echo "Error: psql not found. Install PostgreSQL client." >&2
  exit 1
fi

# Connection from environment
export PGHOST="${PG_HOST:-localhost}"
export PGPORT="${PG_PORT:-5432}"
export PGDATABASE="${PG_DATABASE:-postgres}"
export PGUSER="${PG_USER:-postgres}"
export PGPASSWORD="${PG_PASSWORD:-}"

# Schema via search_path
SCHEMA="${PG_SCHEMA:-public}"
export PGOPTIONS="-c search_path=${SCHEMA}"

# Test connection on first use (cache result)
if [[ ! -f /tmp/.psql_connected_${PGHOST}_${PGDATABASE} ]]; then
  if ! psql -X -q -c "SELECT 1" &>/dev/null; then
    echo "Error: Cannot connect to ${PGHOST}:${PGPORT}/${PGDATABASE}" >&2
    echo "Check PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD" >&2
    exit 2
  fi
  touch "/tmp/.psql_connected_${PGHOST}_${PGDATABASE}"
fi

# Pass all arguments through to psql
# -X: skip .psqlrc
# -q: quiet (no welcome message)
exec psql -X -q "$@"
