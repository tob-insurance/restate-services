# Common Query Patterns

## DDL Extraction

### Function Source
```bash
./scripts/psql.sh -c "\sf function_name"
```

### Function with Schema
```sql
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = current_schema() AND p.proname = 'function_name';
```

### Table DDL (pg_dump)
```bash
pg_dump -t table_name --schema-only | ./scripts/psql.sh
```

## Cursor Pagination

```sql
-- First page
SELECT id, name FROM users
WHERE id > 0
ORDER BY id
LIMIT 51;  -- +1 to detect hasMore

-- Next page (use last id)
SELECT id, name FROM users
WHERE id > $last_id
ORDER BY id
LIMIT 51;
```

## Compact JSON

```sql
-- Array of objects (most compact)
SELECT COALESCE(json_agg(t), '[]'::json)
FROM (SELECT id, name FROM users LIMIT 50) t;

-- Single object
SELECT row_to_json(t)
FROM (SELECT * FROM users WHERE id = 1) t;

-- Nested
SELECT json_build_object(
  'user', row_to_json(u),
  'orders', COALESCE((
    SELECT json_agg(o) FROM orders o WHERE o.user_id = u.id
  ), '[]')
)
FROM users u WHERE u.id = 1;
```

## Existence Checks

```sql
-- Table exists
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = current_schema() AND table_name = 'users'
);

-- Column exists
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'users' AND column_name = 'email'
);
```

## Enum Values

```sql
SELECT enumlabel
FROM pg_enum e
JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'status_type'
ORDER BY e.enumsortorder;
```

## Dependencies

```sql
-- What depends on this function
SELECT DISTINCT d.refobjid::regproc
FROM pg_depend d
JOIN pg_proc p ON d.objid = p.oid
WHERE p.proname = 'function_name' AND d.deptype = 'n';
```
