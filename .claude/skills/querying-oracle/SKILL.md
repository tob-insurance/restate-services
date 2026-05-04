---
name: querying-oracle
description: Executes Oracle queries via sqlplus with pre-configured connection. Use when querying Oracle databases, exploring schema, or validating PL/SQL. Triggers on mentions of Oracle, sqlplus, PL/SQL, or Oracle schema exploration.
---

# Oracle Queries

Connection is pre-configured. Just query.

**IMPORTANT:** Replace `$SKILL_DIR` below with the "Base directory for this skill" path shown in the skill header above.

## Quick Start

```bash
# Replace $SKILL_DIR with the base directory path from the header
$SKILL_DIR/scripts/sqlplus.sh "SELECT table_name FROM user_tables WHERE ROWNUM <= 20"
$SKILL_DIR/scripts/sqlplus.sh "DESC employees"
$SKILL_DIR/scripts/sqlplus.sh -f script.sql
```

## Row Limiting

```sql
-- Always limit results
SELECT * FROM employees WHERE ROWNUM <= 50

-- With ordering (use subquery)
SELECT * FROM (
  SELECT * FROM employees ORDER BY hire_date DESC
) WHERE ROWNUM <= 50
```

## Schema Exploration

```bash
# List tables
$SKILL_DIR/scripts/sqlplus.sh "SELECT table_name FROM user_tables ORDER BY table_name"

# Describe table
$SKILL_DIR/scripts/sqlplus.sh "DESC table_name"

# List procedures/functions
$SKILL_DIR/scripts/sqlplus.sh "SELECT object_name, object_type FROM user_objects WHERE object_type IN ('PROCEDURE','FUNCTION','PACKAGE') ORDER BY object_type, object_name"

# Search objects
$SKILL_DIR/scripts/sqlplus.sh "SELECT object_name, object_type FROM user_objects WHERE object_name LIKE '%PATTERN%'"
```

## Executing SQL Files

**IMPORTANT:** If you already have a `.sql` file, use `-f` to execute it directly. Do NOT copy the SQL content inline.

```bash
# CORRECT: Execute existing file directly
$SKILL_DIR/scripts/sqlplus.sh -f /path/to/procedure.sql

# WRONG: Don't copy file content inline
$SKILL_DIR/scripts/sqlplus.sh "CREATE OR REPLACE PROCEDURE..." # Avoid for large statements
```

**When to use `-f` vs inline:**
- `-f /path/to/file.sql` - For existing SQL files, procedures, functions, packages
- `"SELECT..."` - For short ad-hoc queries, DESC, schema exploration

## Guidelines

- **Use -f for existing files** - never copy SQL content when file already exists
- **Always ROWNUM** - default 50, max 100
- **Use DESC** - faster than querying data dictionary
- **Subquery for ORDER BY** - ROWNUM applies before ORDER BY
- **No semicolon needed** - script adds it automatically

## Get Source Code

```sql
-- Function/procedure source
SELECT text FROM user_source
WHERE name = 'FUNCTION_NAME'
ORDER BY line

-- Package spec + body
SELECT text FROM user_source
WHERE name = 'PACKAGE_NAME'
  AND type IN ('PACKAGE', 'PACKAGE BODY')
ORDER BY type, line
```

## Error Handling

Script exits with SQL error code on failure via `WHENEVER SQLERROR EXIT SQL.SQLCODE`.

```bash
$SKILL_DIR/scripts/sqlplus.sh "SELECT * FROM nonexistent"
echo $?  # Non-zero on error
```

See [common-queries.md](references/common-queries.md) for DDL extraction, dependencies, and advanced patterns.
