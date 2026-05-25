# Finance App

Implements daily closing workflow orchestrating:
1. Genius PostgreSQL closing
2. PostgreSQL financial metrics calculation

## Build & Development

```bash
# Development with hot reload
bun run dev

# Build TypeScript
bun run build

# Start production server
bun run start

# Bundle for deployment
bun run bundle

# Typecheck
bun run typecheck
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

```
src/
├── app.lambda.ts             # Lambda entry point
├── app.local.ts              # Local development entry point
├── constants.ts              # Configuration constants
├── infrastructure/
│   └── database.ts           # PostgreSQL database client
└── modules/
    ├── closing/              # Daily closing workflow
    ├── financial-metrics/    # PostgreSQL metrics calculation
    └── trial-balance-sync/   # Trial balance sync service
```

## Environment Variables

```env
# Database Connection String
# Primary: DATABASE_URL (standard across all apps)
# Fallback: POSTGRES_URL (backward compat)
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/finance?schema=financial_report

# Scheduler Configuration (Jakarta Time)
DAILY_CLOSING_SCHEDULE_TIME=00:00    # Default: 00:00 (midnight)
```

**Schedule Configuration:**
- `DAILY_CLOSING_SCHEDULE_TIME`: Time in HH:mm format (24-hour) in Jakarta timezone
- Examples: `00:00` (midnight), `02:30` (2:30 AM), `18:00` (6:00 PM)
