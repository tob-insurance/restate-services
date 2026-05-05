# @restate-tob/shared

Shared utilities and types used across Restate services.

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
├── types/
│   ├── common.ts   # Shared type definitions
│   └── index.ts
├── utils/
│   ├── date.ts     # Date utility functions
│   └── index.ts
└── index.ts        # Public API exports
```

## Exports

- `@restate-tob/shared` — main entry (all exports)
- `@restate-tob/shared/types` — type definitions only
- `@restate-tob/shared/utils` — utility functions only
