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
