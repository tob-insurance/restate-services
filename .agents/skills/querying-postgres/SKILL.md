---
name: querying-postgres
description: Executes PostgreSQL queries via psql with pre-configured connection. Use when querying databases, exploring schema, validating SQL, or extracting DDL. Triggers on mentions of PostgreSQL, psql, database queries, table schema, or SQL validation.
---

# PostgreSQL Queries

Connection and schema are pre-configured. Just query.

**IMPORTANT:** Replace `$SKILL_DIR` below with the "Base directory for this skill" path shown in the skill header above.

## Quick Start

```bash
# Replace $SKILL_DIR with the base directory path from the header
$SKILL_DIR/scripts/psql.sh -c "\dt"                    # List tables
$SKILL_DIR/scripts/psql.sh -c "\d users"               # Describe table
$SKILL_DIR/scripts/psql.sh --csv -c "SELECT * FROM users LIMIT 50"
```

## Output Formats

| Flag | Use |
|------|-----|
| `--csv` | Structured data (recommended) |
| `-t -A` | Raw values only |
| `-t` | Tuples only (no headers) |

## Schema Exploration

```bash
$SKILL_DIR/scripts/psql.sh -c "\dt *pattern*"     # Search tables
$SKILL_DIR/scripts/psql.sh -c "\df *pattern*"     # Search functions
$SKILL_DIR/scripts/psql.sh -c "\sf funcname"      # Function source
$SKILL_DIR/scripts/psql.sh -c "\d+ tablename"     # Table details
```

## Executing SQL Files

**IMPORTANT:** If you already have a `.sql` file, use `-f` to execute it directly. Do NOT copy the SQL content inline.

```bash
# CORRECT: Execute existing file directly
$SKILL_DIR/scripts/psql.sh -f /path/to/file_postgresql.sql

# WRONG: Don't copy file content inline
$SKILL_DIR/scripts/psql.sh -c "CREATE FUNCTION..." # Avoid for large statements
```

**When to use `-f` vs `-c`:**
- `-f /path/to/file.sql` - For existing SQL files, multi-statement scripts, functions, procedures
- `-c "SELECT..."` - For short ad-hoc queries, schema exploration commands (\dt, \d, etc.)

## Guidelines

- **Use -f for existing files** - never copy SQL content when file already exists
- **Always LIMIT** - default 50, max 100
- **Validate first** - use `EXPLAIN` before complex queries
- **Prefer \d commands** - faster than information_schema queries

## JSON Output

```sql
SELECT json_agg(t) FROM (SELECT id, name FROM users LIMIT 50) t;
```

## Error Handling

```bash
$SKILL_DIR/scripts/psql.sh -v ON_ERROR_STOP=1 -c "SELECT..."
# Exit code: 0=ok, 1=error
```

See [common-queries.md](references/common-queries.md) for DDL extraction, pagination, and advanced patterns.
