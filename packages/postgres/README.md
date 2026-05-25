# @restate-tob/postgres

PostgreSQL connection pool, client singleton, cursor streaming, and error handling utilities for Restate services. Built on `pg` and `pg-cursor`.

## Build & Development

```bash
bun run build       # Compile TypeScript
bun run typecheck   # Typecheck only
bun run dev         # Watch mode
bun run clean       # Remove dist/
```

## Architecture

```
src/
├── client.ts       # createPostgresClient, withConnection
├── errors.ts       # PG error codes and integrity checks
├── singleton.ts    # Global client singleton (Lambda-friendly)
├── stream.ts       # Cursor streaming for large result sets
├── types.ts        # PostgresClient, PostgresConfig
└── index.ts        # Public API exports
```

## Exports

- `createPostgresClient(config)` -- creates a pooled client with optional schema
- `withConnection(client, operation)` -- borrows a connection, auto-releases after operation
- `getGlobalPostgresClient` / `resetGlobalPostgresClient` / `closeGlobalPostgresClient` -- singleton helpers
- `Cursor` / `PG_STREAM` / `withConnectionGenerator` -- cursor-based streaming
- `PG_ERROR_CODES` -- PostgreSQL error code constants (`NOT_NULL_VIOLATION`, `FOREIGN_KEY_VIOLATION`, etc.)
- `isDataIntegrityError(code)` -- checks if a PG error code is a data integrity violation
- Types: `PostgresClient`, `PostgresConfig`, `PgErrorCode`, `PoolClient`

## Connection Configuration

| Setting | Value |
|---------|-------|
| Pool minimum | 2 (0 in Lambda) |
| Pool maximum | 20 (1 in Lambda) |
| Connection timeout | 10s |
| Statement timeout | 300s |
| Idle timeout | 30s |

Schema name is validated against `^[a-zA-Z_][a-zA-Z0-9_]*$` and auto-applied as `search_path` on connect.
