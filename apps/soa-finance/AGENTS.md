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
│   ├── database/             # PostgreSQL database client and queries
│   ├── s3/                   # S3 archival upload (no download — buffers pass directly to email)
│   ├── email/                # Email sending service (Microsoft Graph)
│   └── gotenberg/            # PDF generation client
├── modules/
│   ├── data-access/           # Shared staging table reader (PostgreSQL)
│   ├── document-generation/   # Shared PDF, Excel generation
│   ├── email/                 # Email sending and templates
│   ├── payment/               # Payment reconciliation
│   ├── reminder/              # Reminder letter processing
│   └── soa/                   # SOA workflows, services, and virtual objects
└── pipeline/                 # Staging table pipeline (PostgreSQL ETL)
```

**Service Ports:**
- Restate Server: `localhost:8080` (ingress), `localhost:9070` (admin UI)
- Application: `localhost:9080`

## Restate Workflow Architecture

### Workflows

- **BatchWorkflow** (`batch-workflow.ts`): Orchestrates batch SOA processing with a bounded worker pool (max 5 concurrent child virtual objects). Uses `RestatePromise.all` for chunk completion detection.
- **SoaScheduler** (`scheduler.ts`): Self-scheduling Virtual Object that triggers pipeline + batch on configured days.
- **SoaCustomer** (`soa-customer.ts`): Per-customer Virtual Object processing. Decides between new SOA generation or reminder letter processing based on existing reminders.
- **LetterCounter** (`letter-counter.ts`): Global sequence number generator for reminder letters.

### Key Restate Patterns in This App

**Worker pool with error isolation:**
- Child workflow promises use `.map(value, failure)` to convert failures into result objects
- `RestatePromise.all` always resolves, failed accounts are logged and counted
- Batch continues processing remaining accounts after individual failures

**Avoid journal bloat:**
- `ctx.run()` callbacks that generate files should return only file names/paths, not raw Buffers
- Combine generate + S3 archival upload + email sending into a single `ctx.run()` so binary data stays inside the callback — see `process-branches.ts` and `generate-reminder-letter.ts` for the pattern
- Documents pass as `IFileData` buffers from generation directly to email; no S3 download round-trip
- S3 is used for archival upload only (after email send, inside the same `ctx.run()`)

**Branch error isolation:**
- `processBranchSoa` isolates per-branch failures via `.map(value, failure)` returning result objects — one branch failure doesn't kill the customer
- Each branch generates its own documents and sends its own email (per-branch emails for multi-branch customers)

**Context threading:**
- All functions that make external calls must receive `WorkflowContext` and wrap calls in `ctx.run()`
- Use `ctx.console.log` instead of `console.log` for logs within handler scope
- Pure logic functions (no external calls) do not need `ctx`

## Environment Variables

```env
# Application Environment
APP_ENV=development                              # development | production
NODE_ENV=development

# PostgreSQL Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Microsoft Graph (email sending)
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_SHARED_MAILBOX=shared@tob-ins.com
AZURE_INITIATOR_EMAIL=initiator@tob-ins.com

# Gotenberg PDF Lambda
GOTENBERG_URL=https://xxxx.lambda-url.ap-southeast-3.on.aws

# S3 Storage (via Gateway Endpoint)
S3_BUCKET=soa-finance-xxxxxxxx
S3_PIPELINE_PREFIX=parquet

# Squid Proxy for external HTTPS
HTTPS_PROXY=http://172.31.0.x:3128

# Test email recipient (dev only)
TEST_EMAIL_RECIPIENT=you@tob-ins.com
```

> Full deployment guide: [`docs/deployment.md`](docs/deployment.md)
