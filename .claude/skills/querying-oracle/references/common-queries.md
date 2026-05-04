# Oracle Common Query Patterns

## DDL Extraction

### Table DDL
```sql
SELECT DBMS_METADATA.GET_DDL('TABLE', 'TABLE_NAME') FROM dual;
```

### Function/Procedure DDL
```sql
SELECT DBMS_METADATA.GET_DDL('FUNCTION', 'FUNCTION_NAME') FROM dual;
SELECT DBMS_METADATA.GET_DDL('PROCEDURE', 'PROC_NAME') FROM dual;
```

### Package DDL
```sql
SELECT DBMS_METADATA.GET_DDL('PACKAGE_SPEC', 'PKG_NAME') FROM dual;
SELECT DBMS_METADATA.GET_DDL('PACKAGE_BODY', 'PKG_NAME') FROM dual;
```

## Source Code

### Function/Procedure Source
```sql
SELECT line, text FROM user_source
WHERE name = 'OBJECT_NAME' AND type = 'FUNCTION'
ORDER BY line;
```

### Package Source (Spec + Body)
```sql
SELECT type, line, text FROM user_source
WHERE name = 'PKG_NAME'
ORDER BY DECODE(type, 'PACKAGE', 1, 'PACKAGE BODY', 2), line;
```

## Schema Exploration

### List Columns
```sql
SELECT column_name, data_type, nullable, data_default
FROM user_tab_columns
WHERE table_name = 'TABLE_NAME'
ORDER BY column_id;
```

### List Constraints
```sql
SELECT constraint_name, constraint_type, search_condition
FROM user_constraints
WHERE table_name = 'TABLE_NAME';
```

### List Indexes
```sql
SELECT index_name, uniqueness, column_name
FROM user_indexes i
JOIN user_ind_columns c ON i.index_name = c.index_name
WHERE i.table_name = 'TABLE_NAME'
ORDER BY index_name, column_position;
```

### List Triggers
```sql
SELECT trigger_name, triggering_event, trigger_body
FROM user_triggers
WHERE table_name = 'TABLE_NAME';
```

## Dependencies

### What does this object depend on?
```sql
SELECT referenced_name, referenced_type
FROM user_dependencies
WHERE name = 'OBJECT_NAME';
```

### What depends on this object?
```sql
SELECT name, type
FROM user_dependencies
WHERE referenced_name = 'OBJECT_NAME';
```

## Pagination

### Offset-based (12c+)
```sql
SELECT * FROM employees
ORDER BY hire_date
OFFSET 20 ROWS FETCH NEXT 50 ROWS ONLY;
```

### ROWNUM-based (legacy)
```sql
SELECT * FROM (
  SELECT a.*, ROWNUM rnum FROM (
    SELECT * FROM employees ORDER BY hire_date
  ) a WHERE ROWNUM <= 70
) WHERE rnum > 20;
```

## Existence Checks

### Table Exists
```sql
SELECT COUNT(*) FROM user_tables WHERE table_name = 'TABLE_NAME';
```

### Column Exists
```sql
SELECT COUNT(*) FROM user_tab_columns
WHERE table_name = 'TABLE_NAME' AND column_name = 'COLUMN_NAME';
```

### Object Exists
```sql
SELECT COUNT(*) FROM user_objects
WHERE object_name = 'OBJECT_NAME' AND object_type = 'FUNCTION';
```

## Type Information

### List Types
```sql
SELECT type_name, typecode FROM user_types;
```

### Type Attributes
```sql
SELECT attr_name, attr_type_name, length
FROM user_type_attrs
WHERE type_name = 'TYPE_NAME'
ORDER BY attr_no;
```

## Function Testing

### Call Function
```sql
SELECT function_name(param1, param2) FROM dual;
```

### Call Procedure (with OUT params)
```sql
DECLARE
  v_result VARCHAR2(100);
BEGIN
  proc_name(param1, v_result);
  DBMS_OUTPUT.PUT_LINE(v_result);
END;
/
```

## NULL Handling (Oracle-specific)

```sql
-- NVL: returns second if first is NULL
SELECT NVL(nullable_col, 'default') FROM table;

-- DECODE: switch-case
SELECT DECODE(status, 'A', 'Active', 'I', 'Inactive', 'Unknown') FROM table;

-- NVL2: if not null then X else Y
SELECT NVL2(nullable_col, 'has value', 'is null') FROM table;
```
