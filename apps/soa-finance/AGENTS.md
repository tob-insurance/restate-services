# SOA Finance App

Implements Statement of Account (SOA) and Reminder Letter generation.

## Build & Development

```bash
# Development with hot reload
bun run dev

# Build TypeScript
bun run build

# Typecheck
bun run typecheck
```

## Architecture

```
src/
├── app.lambda.ts             # Lambda entry point
├── app.local.ts              # Local development entry point
├── infrastructure/
│   ├── database/             # Oracle database client and queries
│   ├── azure/                # Azure Blob Storage integration
│   ├── email/                # Email sending service (Microsoft Graph)
│   └── gotenberg/            # PDF generation client
├── modules/
│   ├── document-generation/  # Shared PDF, Excel, letter number generation
│   ├── email/                # Email sending and templates
│   ├── job/                  # Job tracking
│   ├── payment/              # Payment reconciliation
│   ├── reminder/             # Reminder letter processing
│   └── soa/                  # SOA workflows and services
└── pipeline/                 # Data pipeline for Parquet processing
```

**Service Ports:**
- Restate Server: `localhost:8080` (ingress), `localhost:9070` (admin UI)
- Application: `localhost:9080`

## Restate Workflow Architecture

### Workflows

- **BatchWorkflow** (`batch-workflow.ts`): Orchestrates batch SOA processing with a bounded worker pool (max 5 concurrent child workflows). Uses `RestatePromise.race` for worker completion detection.
- **SoaWorkflow** (`soa-workflow.ts`): Per-customer SOA processing. Decides between new SOA generation or reminder letter processing based on existing reminders.

### Key Restate Patterns in This App

**Worker pool with error isolation:**
- Child workflow promises use `.map(value, failure)` to convert failures into result objects
- `RestatePromise.race` always resolves, failed accounts are logged and counted
- Batch continues processing remaining accounts after individual failures

**Avoid journal bloat:**
- `ctx.run()` callbacks that generate files should return only file names/paths, not raw Buffers
- Combine download + email sending into a single `ctx.run()` so binary data stays inside the callback
- See `generate-reminder-letter.ts` for the pattern: generate+upload returns file names, then download+send in one step

**Context threading:**
- All functions that make external calls must receive `WorkflowContext` and wrap calls in `ctx.run()`
- Use `ctx.console.log` instead of `console.log` for logs within handler scope
- Pure logic functions (no external calls) do not need `ctx`

## Environment Variables

```env
# Oracle Database
ORACLE_URL=oracle://your_oracle_user:your_oracle_password@localhost:1521/ORCL

# Microsoft Graph (for email)
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret

# Email sender (optional, has fallback)
SENDER_EMAIL=sender@example.com

# Azure Storage
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
AZURE_STORAGE_CONTAINER_NAME=soa-documents
AZURE_STORAGE_SOA_PREFIX=soa/

# Optional: Oracle Instant Client library path (only needed on Windows/macOS)
ORACLE_LIB_DIR=/path/to/instantclient
```
