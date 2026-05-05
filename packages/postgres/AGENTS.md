# @restate-tob/postgres

PostgreSQL database client with connection pooling for Restate services.

## Build & Development

```bash
bun run build       # Build TypeScript
bun run typecheck   # Typecheck
bun run dev         # Watch mode
bun run clean       # Remove dist/
```

## Architecture

```
src/
├── client.ts       # Connection pool, withConnection helper
├── errors.ts       # Error types and handling
├── types.ts        # PostgresClient, PostgresConfig types
└── index.ts        # Public API exports
```

## Usage

- `createPostgresClient(config)` — creates a pooled PostgreSQL client with optional schema
- `withConnection(client, operation)` — borrows a connection, auto-releases after operation

## Connection Config

- Pool: min 2, max 20
- Timeouts: 10s connection, 300s statement/query timeout
- Schema name validated against `^[a-zA-Z_][a-zA-Z0-9_]*$`
- Auto-sets `search_path` on connect if schema provided
