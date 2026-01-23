# SOA Finance Service

This service is developed using **Restate** to handle a data processing pipeline (Oracle > Data Stream > Parquet) leveraging the concept of **Durable Execution**.

## Project Structure

The project follows a custom directory structure designed to separate technical concerns, business logic, and data storage:

- `src/infrastructure/`: Technical implementation and external connections.
  - `database.ts`: Manages database connections (Oracle/PostgreSQL).
  - `parquet.ts`: Handles Parquet file processing and writing.
  - `stream.ts`: Configures the data streaming pipeline.
- `src/module/`: Contains the core business logic, divided into:
  - `handlers/`: Atomic functions for specific tasks (Activities).
  - `services/`: Implementation of detailed business rules.
  - `workflows/`: Process orchestration and flow management (Durable Execution).
  - `utils/`: Helpers specific to business domain logic.
- `src/datas/`: Storage directory for output data (e.g., generated Parquet files).
- `src/app.ts`: Main entry point and service registration with Restate.

## Getting Started

### 1. Prerequisites

- [Bun](https://bun.sh/) (Runtime & Package Manager)
- [Docker](https://www.docker.com/) (To run the Restate Server)

### 2. Install Dependencies

Run the installation command from the root of the monorepo:

```bash
bun install
```

### 3. Run Restate Server (Docker)

Start the Restate server for local development:

```bash
docker run --name restate_dev --rm \
  -p 8080:8080 -p 9070:9070 -p 9071:9071 \
  --add-host=host.docker.internal:host-gateway \
  docker.restate.dev/restatedev/restate:latest
```

### 4. Run the soa-finance Service

Run the service in development mode with hot-reload:

```bash
cd apps/soa-finance
bun run dev
```

### 5. Register the Service with Restate

In a new terminal, register the running service:

```bash
restate deployments register http://localhost:9080
```

## Core Concepts

### Data Pipeline

1. **Oracle**: Extracts data from the source database.
2. **Stream**: Streams data in real-time through the pipeline.
3. **Parquet**: Stores the final results in an optimized columnar format.

### Workflows vs Handlers

- **Workflow**: Manages the sequence of processes. If the process is interrupted (e.g., server failure), Restate automatically resumes from the last successful step.
- **Handlers**: Atomic tasks such as `fetchFromOracle` or `writeToParquet`. Every instruction within a handler is executed idempotently by Restate.

## Monitoring

Access the Restate Dashboard to monitor active workflows and service health:
[http://localhost:9070](http://localhost:9070)
