# @restate-tob/oracle

Oracle database client with connection pooling for Restate services.

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
├── client.ts       # Connection pool, withConnection helper, query/procedure execution
├── entities.ts     # Entity definitions
├── repository.ts   # Repository pattern implementation
├── types.ts        # OracleClient, OracleConfig, query result types
└── index.ts        # Public API exports
```

## Usage

- `createOracleClient(config)` — creates a pooled Oracle client with thick/thin mode auto-detection
- `withConnection(client, operation)` — borrows a connection, auto-releases after operation
- `withConnectionGenerator(client, operation)` — same but for async generators
- `executeQuery` / `executeMany` / `executeProcedure` — typed query helpers

## Connection Config

- Pool: min 0 (Lambda) or 2 (local), max 1 (Lambda) or 10 (local)
- Timeouts: 60s connection, 60s queue
- Thick mode auto-initializes via `LD_LIBRARY_PATH` on Lambda/Linux, or `instantClientPath` on macOS/Windows
