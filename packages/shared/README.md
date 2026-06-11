# @restate-tob/shared

Shared Zod schemas, date utilities, constants, and logger for Restate services.

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
├── schemas.ts      # Zod validation schemas
├── constants.ts    # Shared constants (timezone, content types)
├── utils/
│   ├── date.ts     # Date utility functions
│   ├── logger.ts   # Pino logger instance
│   └── index.ts    # Utils barrel export
└── index.ts        # Public API exports
```

## Exports

**`@restate-tob/shared`** (main entry):

- `DateStringSchema` -- validates `YYYY-MM-DD` format
- `UserIdSchema` -- validates alphanumeric + underscore user IDs
- `UuidSchema` -- validates UUID format
- `TIMEZONE` -- `"Asia/Jakarta"`
- `CONTENT_TYPES` -- MIME type constants (`PDF`, `XLSX`, `XLS`, `HTML`, `CSV`, `OCTET_STREAM`)
- `parseDateParts` -- date string parser
- `logger` -- Pino logger instance

**`@restate-tob/shared/utils`** (utils subpath):

- `parseDateParts` -- date string parser
- `logger` -- Pino logger instance
