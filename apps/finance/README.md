# Daily Closing Workflow - Restate

Durable workflow untuk menjalankan proses daily closing yang terdiri dari:

1.  **Genius Oracle Closing** (dapat memakan waktu hingga 6 jam)
2.  **PostgreSQL Financial Metrics Calculation**
3.  **Automated Scheduler** (Cron Job)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Edit file `.env`:

```env
# PostgreSQL Configuration
PG_HOST=127.0.0.1
PG_PORT=5432
PG_DATABASE=postgres
PG_USER=postgres
PG_PASSWORD=your_password
PG_SCHEMA=financial_report

# Oracle Configuration (Genius)
ORACLE_USER=ACPDB
ORACLE_PASSWORD=your_oracle_password
ORACLE_CONNECT_STRING=(DESCRIPTION=(ADDRESS=(PROTOCOL=tcp)(HOST=aws3.tob-insurance.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=ORCL)))

# Restate Configuration
RESTATE_PORT=9080
```

### 3. Install & Start Restate Server

```bash
# Install Restate CLI
npm install -g @restatedev/restate

### 4. Start Your Service

```bash
# Build TypeScript
npm run build

# Start Service (terminal 2)
npm run start
# Atau untuk development: npm run dev
```

### 5. Register Service ke Restate

```bash
restate deployments register http://localhost:9080
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Deployment Architecture                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐         ┌──────────────────┐        │
│  │  Restate Server  │◄───────►│  Your Service    │        │
│  │  localhost:8080  │         │  localhost:9080  │        │
│  │  (Ingress API)   │         │  (Workflow Code) │        │
│  │                  │         │                  │        │
│  │  localhost:9070  │         └──────────────────┘        │
│  │  (Admin API/UI)  │                 │                   │
│  └──────────────────┘                 │                   │
│          ▲                            │                   │
│          │                            ▼                   │
│          │                   ┌────────────────┐          │
│    ┌─────┴──────┐           │   Databases    │          │
│    │ Scheduler  │           │  - PostgreSQL  │          │
│    │ (Cron Job) │           │  - Oracle      │          │
│    └────────────┘           └────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Scheduler (Cron Job)

Aplikasi ini memiliki **DailyClosingScheduler** yang berjalan otomatis setiap hari.

### Konfigurasi Jadwal
Edit `src/services/scheduler.ts`:
```typescript
const SCHEDULE_CONFIG = {
    hour: 0,
    minute: 0,
};
```

### Memulai Scheduler
Scheduler perlu dipancing sekali untuk mulai berjalan (kickstart):

```bash
curl -X POST http://localhost:8080/DailyClosingScheduler/main/start
```

Setelah itu, ia akan otomatis berjalan setiap hari pada jam yang ditentukan.

## Menjalankan Workflow Manual

### Trigger Workflow Manual
```bash
curl http://localhost:8080/DailyClosing/2025-11-24/run/send \
  --json '{"date": "2025-11-24", "userId": "ASK"}'
```

### Check Status
```bash
curl http://localhost:8080/DailyClosing/2025-11-24/getStatus
```

### View in Restate UI
Akses **http://localhost:9070** untuk melihat visualisasi workflow.

## Struktur Folder

```
src/
├── app.ts                          # Entry point & Registration
├── db.ts                           # PostgreSQL connection
├── oracle.ts                       # Oracle connection
├── services/
│   ├── financialMetrics.ts        # Financial metrics logic
│   ├── geniusClosing.ts           # Genius Oracle logic
│   └── scheduler.ts               # Cron Job Scheduler
└── workflows/
    └── dailyClosing.ts            # Main Workflow orchestration
```

## Deployment

Lihat panduan lengkap di [DEPLOYMENT.md](./deployment_guide.md).

1.  **Build**: `npm run build`
2.  **Run**: `node dist/app.js` (atau via Docker)
3.  **Register**: `restate deployments register <service-url>`
