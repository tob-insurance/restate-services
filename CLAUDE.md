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
- Shared packages go in `packages/` (currently unused)

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
- Throw `TerminalError` for non-retryable failures

### Finance App (`apps/finance`)

Implements daily closing workflow orchestrating:
1. Genius Oracle closing (stored procedure, up to 6 hours)
2. PostgreSQL financial metrics calculation

```
src/
├── app.ts                    # Entry point, registers services
├── pg.ts                     # PostgreSQL connection pool
├── oracle.ts                 # Oracle DB connection
├── services/
│   ├── geniusClosing.ts     # Oracle stored procedure execution
│   ├── financialMetrics.ts  # PostgreSQL metrics calculation
│   └── scheduler.ts         # Cron-style scheduler (Virtual Object)
└── workflows/
    └── dailyClosing.ts      # Main workflow orchestration
```

**Service Ports:**
- Restate Server: `localhost:8080` (ingress), `localhost:9070` (admin UI)
- Application: `localhost:9080`

## Environment Variables

Required for `apps/finance`:

```env
PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD, PG_SCHEMA
ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING
```
