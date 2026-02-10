# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies (from root)
bun install

# Start all apps in dev mode
bun run dev

# Build all apps
bun run build

# Run single app in dev mode
bun run --filter @finance/closing dev

# Build single app
bun run --filter @finance/closing build
```

### Linting & Typechecking

```bash
# Lint (from root only)
bun run check

# Lint fix (from root only)
bun run fix

# Typecheck all apps and packages
bun run typecheck

# Typecheck single app
cd apps/finance && bun run typecheck
cd apps/soa-finance && bun run typecheck

# Typecheck single package
cd packages/oracle && bun run typecheck
cd packages/postgres && bun run typecheck
cd packages/shared && bun run typecheck
```

Linting uses [ultracite](https://github.com/harbordev/ultracite) (wraps Biome). Lefthook runs `ultracite fix` on pre-commit automatically.

### Finance App Specific

```bash
cd apps/finance

# Development with hot reload
bun run dev

# Build TypeScript
bun run build

# Start production server
bun run start

# Bundle for deployment
bun run bundle
```

### Restate Server Setup

```bash
# Start Restate server
restate-server

# Register service after starting
restate deployments register http://localhost:9080

# Trigger workflow manually
curl http://localhost:8080/DailyClosing/2025-01-01/run/send --json '{"date": "2025-01-01", "userId": "ASK"}'

# Start scheduler (one-time kickstart)
curl -X POST http://localhost:8080/DailyClosingScheduler/main/start
```

## Architecture

### Monorepo Structure

- **Turborepo + Bun workspaces** manage the monorepo
- Apps live in `apps/` directory, each with independent `package.json`
- Shared packages in `packages/`:
  - `@restate-tob/oracle`: Oracle database client with connection pooling
  - `@restate-tob/postgres`: PostgreSQL database client
  - `@restate-tob/shared`: Shared utilities and types

### Restate Framework

This codebase uses [Restate](https://restate.dev) for durable execution. Key concepts:

- **Workflows** (`restate.workflow`): Long-running, resumable processes with a `run` handler
- **Virtual Objects** (`restate.object`): Stateful, key-addressable services
- **Services** (`restate.service`): Stateless handlers

**Critical Restate Rules:**
- Wrap all external calls (DB, API) in `ctx.run()` for durability
- Use `ctx.sleep()` instead of `setTimeout`
- Use `ctx.date.now()` instead of `Date.now()` for deterministic replay
- Use `RestatePromise.all/race/any` instead of native `Promise` methods
- Throw `TerminalError` for non-retryable failures (validation errors, data integrity errors)
- Always propagate errors - do not catch and return success:false in workflows
- **NEVER call Restate context methods inside `ctx.run()` callbacks** (see below)

**ctx.run() Side Effect Rules (CRITICAL for Lambda):**

On AWS Lambda, Restate uses suspension semantics. Calling context methods inside `ctx.run()` causes deadlocks because the Lambda suspends while the side effect is waiting for context operations that can't complete.

```typescript
// ❌ WRONG - ctx.date.now() inside ctx.run() causes deadlock on Lambda
const result = await ctx.run("my-side-effect", async () =>
  doSomething(await ctx.date.now())  // Will hang on Lambda!
);

// ✅ CORRECT - Get context values BEFORE entering ctx.run()
const currentTime = await ctx.date.now();
const result = await ctx.run("my-side-effect", async () =>
  doSomething(currentTime)
);

// ❌ WRONG - ctx.workflowSendClient() inside ctx.run()
await ctx.run("trigger", () => {
  ctx.workflowSendClient(workflow, key).run(input);  // Will hang!
});

// ✅ CORRECT - Call context methods directly (they're already durable)
ctx.workflowSendClient(workflow, key).run(input);
```

**Context methods that CANNOT be used inside `ctx.run()`:**
- `ctx.date.now()`
- `ctx.rand.uuidv4()` / `ctx.rand.random()`
- `ctx.sleep()`
- `ctx.workflowSendClient()` / `ctx.serviceSendClient()` / `ctx.objectSendClient()`
- `ctx.get()` / `ctx.set()` / `ctx.clear()`
- Any other `ctx.*` method

**Why this works locally but fails on Lambda:**
- Local: Restate runs as persistent process, context is always available
- Lambda: Restate suspends function between operations, context methods inside side effects cause deadlock

### Error Recovery Strategy

**Non-Retryable Errors (use `TerminalError`):**
- Input validation failures (invalid date formats, malformed IDs)
- Data integrity violations (foreign key constraints, unique violations)
- Authorization/authentication failures
- Business logic violations

**Retryable Errors (throw regular Error):**
- Network timeouts
- Database connection failures
- Temporary service unavailability

**Connection Timeouts:**
- PostgreSQL: 10s connection, 300s statement timeout
- Oracle: 60s connection, 60s queue timeout
- All database operations wrapped in connection helpers for proper cleanup

**Workflow State Management:**
- Workflow state persisted at each major step
- State includes: current step, job/run IDs, timestamps
- Failed workflows update state to "failed" before throwing error
- Use `getStatus` handler to query workflow progress at any time

### Finance App (`apps/finance`)

Implements daily closing workflow orchestrating:
1. Genius Oracle closing (stored procedure, up to 6 hours)
2. PostgreSQL financial metrics calculation

```
src/
├── app.lambda.ts             # Lambda entry point
├── app.local.ts              # Local development entry point
├── constants.ts              # Configuration constants
├── infrastructure/
│   └── database.ts           # Database clients (Oracle + PostgreSQL)
└── modules/
    ├── closing/              # Daily closing workflow
    ├── financial-metrics/    # PostgreSQL metrics calculation
    └── trial-balance-sync/   # Trial balance sync service
```

### SOA Finance App (`apps/soa-finance`)

Implements Statement of Account (SOA) and Reminder Letter generation:

```
src/
├── app.lambda.ts             # Lambda entry point
├── app.local.ts              # Local development entry point
├── infrastructure/
│   ├── database/             # Oracle database client and queries
│   ├── azure/                # Azure Blob Storage integration
│   ├── email/                # Email sending service
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

## Environment Variables

Required for `apps/finance`:

```env
# Database Connection Strings
POSTGRES_URL=postgresql://postgres:your_password@localhost:5432/finance?schema=financial_report
ORACLE_URL=oracle://your_oracle_user:your_oracle_password@localhost:1521/ORCL

# Optional: Oracle Instant Client Path (for macOS/Windows)
ORACLE_INSTANT_CLIENT_PATH=/path/to/instantclient

# Scheduler Configuration (Jakarta Time)
DAILY_CLOSING_SCHEDULE_TIME=00:00    # Default: 00:00 (midnight)
```

Required for `apps/soa-finance`:

```env
# Oracle Database
ORACLE_URL=oracle://your_oracle_user:your_oracle_password@localhost:1521/ORCL

# Microsoft Graph (for email)
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret

# Azure Storage
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
AZURE_STORAGE_CONTAINER_NAME=soa-documents
AZURE_STORAGE_SOA_PREFIX=soa/

# Optional: Oracle Instant Client library path (only needed on Windows/macOS)
ORACLE_LIB_DIR=/path/to/instantclient
```

**Schedule Configuration:**
- `DAILY_CLOSING_SCHEDULE_TIME`: Time in HH:mm format (24-hour) in Jakarta timezone
- Examples: `00:00` (midnight), `02:30` (2:30 AM), `18:00` (6:00 PM)
