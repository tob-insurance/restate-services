# Finance Service

Daily Closing Workflow -- orchestrates Genius PostgreSQL closing procedure, trial balance sync, and financial metrics calculation. Built on **Restate Durable Execution** for reliable scheduling and fault-tolerant step-by-step processing.

## Project Structure

```
src/
├── app.lambda.ts             # Lambda entry point
├── app.local.ts              # Local development entry point
├── constants.ts              # Configuration constants
├── infrastructure/
│   └── database.ts           # PostgreSQL database client
└── modules/
    ├── closing/              # Daily closing workflow
    ├── financial-metrics/    # Financial metrics calculation (PostgreSQL)
    └── trial-balance-sync/   # Trial balance sync service
```

## Build & Development

```bash
bun run dev              # Start with hot reload
bun run build            # Compile TypeScript
bun run start            # Start production server (node)
bun run bundle           # Bundle for deployment (esbuild + zip)
bun run typecheck        # Typecheck only
bun run test             # Run tests
```

## Environment Variables

```env
# PostgreSQL database connection
DATABASE_URL=postgresql://postgres:password@localhost:5432/finance?schema=financial_report

# Scheduler -- time in Jakarta timezone (HH:mm, 24-hour)
DAILY_CLOSING_SCHEDULE_TIME=00:00
```

- `DAILY_CLOSING_SCHEDULE_TIME`: Controls when the daily closing workflow fires each day. Defaults to `00:00` (midnight). Examples: `02:30`, `18:00`.

## Restate Setup

```bash
# Start Restate server
restate-server

# Register the service
restate deployments register http://localhost:9080

# Trigger a closing manually
curl http://localhost:8080/DailyClosing/2025-01-01/run/send \
  --json '{"date": "2025-01-01", "userId": "ASK"}'

# Kickstart the scheduler (run once to begin schedule loop)
curl -X POST http://localhost:8080/DailyClosingScheduler/main/start
```

**Service Ports**

- Application: `localhost:9080`
- Restate Ingress: `localhost:8080`
- Restate Admin UI: `localhost:9070`

## Schedule Configuration

The `DailyClosingScheduler` virtual object wakes up at the configured time each day and triggers a `DailyClosing` workflow. Only one invocation per date is allowed -- the workflow is idempotent by date key. Schedule time uses the `Asia/Jakarta` timezone.
