# SOA Finance Service

This service is a **Restate** application designed to handle the Statement of Account (SOA) and Reminder Letter generation pipeline. It uses **Durable Execution** to ensure reliability across complex distributed processes involving PostgreSQL databases, data streaming, Parquet file processing, and external services like Azure Blob Storage and Microsoft Graph.

## Project Structure

The project follows a domain-driven structure to separate concerns:

- **`src/pipeline/`**:
  - Handles high-performance data processing using **Apache Arrow** and **Parquet**.
  - Responsible for reading and processing large datasets efficiently.

- **`src/infrastructure/`**: External adapters and technical implementations.
  - `azure/`: Azure Blob Storage integration for uploading generated reports.
  - `database/`: Database queries and connection management (PostgreSQL).
  - `email/`: Email sending service (Microsoft Graph) and template management.
  - `gotenberg/`: Client for generating PDFs from HTML using Gotenberg.

- **`src/modules/`**: Core business logic.
  - **`soa/`**: Workflows, virtual objects, and services for SOA and reminder processing.
  - **`reminder/`**: Reminder letter creation, processing, and generation.
  - **`document-generation/`**: Excel, PDF generation, and Liquid template rendering.
  - **`email/`**: Email composition and sending with templates.
  - **`data-access/`**: Shared Parquet reading used by modules and pipeline layers.
  - **`types/`**: Shared TypeScript type definitions.

## Prerequisites

- **[Bun](https://bun.sh/)**: Runtime and package manager.
- **[Docker](https://www.docker.com/)**: Required to run the Restate runtime and Gotenberg.
- **Environment Variables**: Create a `.env` file based on `.env.example`:
  - `DATABASE_URL`: PostgreSQL database URL (format: `postgresql://user:password@host:5432/dbname`)
  - `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`: Microsoft Graph credentials
  - `AZURE_STORAGE_CONNECTION_STRING`: Azure Blob Storage connection
  - `AZURE_STORAGE_CONTAINER_NAME`: Container name for SOA documents
  - `AZURE_STORAGE_SOA_PREFIX`: Prefix for SOA files in storage
  - `GOTENBERG_URL`: URL of the Gotenberg service (default: `http://localhost:3000`)

## Getting Started

### 1. Install Dependencies

```bash
bun install
```

### 2. Start Infrastructure

Run the required services (Restate, Gotenberg) using Docker Compose:

```bash
docker-compose up -d
```

- **Restate Admin**: http://localhost:9070
- **Gotenberg**: http://localhost:3000

### 3. Run the Service

Start the application in development mode with hot-reloading:

```bash
bun run dev
```

### 4. Register with Restate

Once the service is running, register it with the Restate runtime:

```bash
http://host.docker.internal:9080
```

## Workflows

### Batch Workflow

The entry point for processing SOAs. It:

1. Determines the processing date and period.
2. Fetches all active customers.
3. Creates a batch record.
4. Triggers `SoaWorkflow` for each customer in chunks to manage load.

### SOA Workflow

Processes an individual customer:

1. **GetSoa**: Fetches SOA data from Parquet/Database.
2. **Filter**: Applies aging and payment reconciliation filters.
3. **Generate**: Creates Excel and PDF reports (using Gotenberg).
4. **Upload**: Uploads files to Azure Blob Storage.
5. **Send**: Sends the SOA/Reminder email via Microsoft Graph.

---

## Workflow SOA

![Flowchart](src/assets/workflow.png)
