#!/usr/bin/env bash
#
# sqlplus.sh - sqlplus wrapper with embedded connection
#
# Environment (set once, then forget):
#   ORACLE_USER, ORACLE_PASSWORD, ORACLE_HOST, ORACLE_PORT, ORACLE_SERVICE
#   Or: ORACLE_CONNECTION (full connection string)
#
# Usage:
#   ./sqlplus.sh "SELECT * FROM users WHERE ROWNUM <= 10"
#   ./sqlplus.sh -f script.sql
#   echo "SELECT 1 FROM dual" | ./sqlplus.sh

set -uo pipefail

# Load .env from skill directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
if [[ -f "$SKILL_DIR/.env" ]]; then
  set -a
  source "$SKILL_DIR/.env"
  set +a
fi

# Verify sqlplus is available
if ! command -v sqlplus &>/dev/null; then
  echo "Error: sqlplus not found. Install Oracle Instant Client." >&2
  exit 1
fi

# Connection from environment
USER="${ORACLE_USER:-}"
PASS="${ORACLE_PASSWORD:-}"
HOST="${ORACLE_HOST:-localhost}"
PORT="${ORACLE_PORT:-1521}"
SERVICE="${ORACLE_SERVICE:-ORCL}"

# Build connection string if not provided
if [[ -n "${ORACLE_CONNECTION:-}" ]]; then
  CONN="$ORACLE_CONNECTION"
elif [[ -n "$USER" && -n "$PASS" ]]; then
  CONN="${USER}/${PASS}@//${HOST}:${PORT}/${SERVICE}"
else
  echo "Error: Set ORACLE_USER/ORACLE_PASSWORD or ORACLE_CONNECTION" >&2
  exit 1
fi

# Parse arguments
SQL=""
FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--file)
      FILE="$2"
      shift 2
      ;;
    *)
      SQL="$1"
      shift
      ;;
  esac
done

# Read SQL from file, argument, or stdin
if [[ -n "$FILE" ]]; then
  if [[ ! -f "$FILE" ]]; then
    echo "Error: File not found: $FILE" >&2
    exit 1
  fi
  SQL=$(cat "$FILE")
elif [[ -z "$SQL" ]]; then
  if [[ ! -t 0 ]]; then
    SQL=$(cat)
  fi
fi

if [[ -z "$SQL" ]]; then
  echo "Error: No SQL provided" >&2
  exit 1
fi

# Block DML/DDL — read-only mode
SQL_UPPER=$(echo "$SQL" | tr '[:lower:]' '[:upper:]' | sed 's/^[[:space:]]*//')
for KEYWORD in INSERT UPDATE DELETE DROP ALTER TRUNCATE CREATE MERGE GRANT REVOKE; do
  if echo "$SQL_UPPER" | grep -qE "(^|[[:space:]])${KEYWORD}[[:space:]]"; then
    echo "Error: Read-only mode — $KEYWORD statements are not allowed" >&2
    exit 3
  fi
done

# Test connection on first use (cache result)
CACHE_FILE="/tmp/.sqlplus_connected_${HOST}_${SERVICE}"
if [[ ! -f "$CACHE_FILE" ]]; then
  if ! echo "SELECT 1 FROM dual;" | sqlplus -S -L "$CONN" &>/dev/null; then
    echo "Error: Cannot connect to ${HOST}:${PORT}/${SERVICE}" >&2
    echo "Check ORACLE_USER, ORACLE_PASSWORD, ORACLE_HOST, ORACLE_PORT, ORACLE_SERVICE" >&2
    exit 2
  fi
  touch "$CACHE_FILE"
fi

# Execute with silent mode and clean output
# SET commands for clean output
sqlplus -S -L "$CONN" <<EOF
SET PAGESIZE 1000
SET LINESIZE 200
SET TRIMSPOOL ON
SET TRIMOUT ON
SET FEEDBACK ON
SET HEADING ON
SET ECHO OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE
${SQL};
EXIT
EOF
