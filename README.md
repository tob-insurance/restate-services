# Daily Closing Workflow - Restate

Durable workflow untuk menjalankan proses daily closing yang terdiri dari:

1. Genius Oracle Closing (dapat memakan waktu hingga 6 jam)
2. PostgreSQL Financial Metrics Calculation

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
# Following node-oracledb best practices: separate credentials from connection string
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

# Start Restate Server dengan konfigurasi untuk long-running workflow (di terminal 1)
# PENTING: Gunakan file restate.config.toml untuk timeout 7 jam
restate-server --config-file restate.config.toml

# Restate Server akan berjalan di:
# - Admin API: http://localhost:9070
# - Ingress API: http://localhost:8080
# - UI: http://localhost:9070 (buka di browser)
```

**⚠️ PENTING**: File `restate.config.toml` sudah dikonfigurasi untuk:

- `invoker.abort-timeout = "7h"` - Mengizinkan stored procedure berjalan hingga 7 jam
- Tanpa ini, Restate akan abort setelah timeout default (60 detik)

### 4. Start Your Service

```bash
# Di terminal terpisah (terminal 2)
npm run dev

# Service akan berjalan di http://localhost:9080
```

### 5. Create PostgreSQL Function (Required)

Buat function `calculate_financial_metrics` di PostgreSQL:

```bash
# Connect to your PostgreSQL database
psql -h 18.136.181.189 -U postgres -d dev

# Run the SQL script
\i sql/create_financial_metrics_function.sql

# Or execute directly:
# \c dev
# CREATE SCHEMA IF NOT EXISTS financial_report;
# -- See sql/create_financial_metrics_function.sql for full script
```

**⚠️ PENTING**: Function ini harus ada sebelum menjalankan workflow, atau gunakan `skipFinancialMetrics=true`

### 6. Register Service ke Restate

Setelah service berjalan, register ke Restate Server:

```bash
# Via Restate CLI (recommended)
restate deployments register http://localhost:9080

# Atau via curl
curl -X POST http://localhost:9070/deployments \
  -H "Content-Type: application/json" \
  -d '{"uri": "http://localhost:9080"}'
```

Anda akan melihat output konfirmasi bahwa workflow `DailyClosing` berhasil terdaftar.

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
│    │   Client   │           │  - PostgreSQL  │          │
│    │ (curl/cron)│           │  - Oracle      │          │
│    └────────────┘           └────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Menjalankan Workflow

### Trigger Workflow (Submit Oracle Job in Background)

```bash
# Submit Genius closing job (runs in background, no timeout issues)
curl http://localhost:8080/DailyClosing/2025-11-24/run/send \
  --json '{"date": "2025-11-24", "userId": "ASK"}'

# Response akan berisi jobName untuk tracking:
# {
#   "oracleClosing": {
#     "submitted": true,
#     "jobName": "GENIUS_CLOSING_2025_11_1732612345678",
#     "message": "Job submitted successfully. It will run in background for up to 6 hours."
#   }
# }
```

### Check Oracle Job Status

```bash
# Gunakan jobName dari response di atas
curl http://localhost:8080/DailyClosing/2025-11-24/checkOracleJobStatus \
  --json '{"jobName": "GENIUS_CLOSING_2025_11_1732612345678"}'

# Response:
# {
#   "status": "RUNNING",       # RUNNING, SUCCEEDED, FAILED
#   "running": true,
#   "completed": false,
#   "failed": false,
#   "message": "Job status details..."
# }
```

### Skip Genius Closing (hanya jalankan Financial Metrics)

```bash
curl http://localhost:8080/DailyClosing/2025-11-24/run/send \
  --json '{"date": "2025-11-24", "skipOracleClosing": true}'
```

### Check Workflow Status

```bash
curl http://localhost:8080/DailyClosing/2025-11-24/getStatus
```

### View in Restate UI

Buka browser dan akses: **http://localhost:9070**

Di sana Anda bisa melihat:

- Semua workflow yang sedang berjalan
- Status eksekusi (pending, running, completed, failed)
- Execution history dan logs
- State management dari setiap workflow

## Struktur Folder

```
src/
├── app.ts                          # Entry point
├── db.ts                           # PostgreSQL connection pool
├── oracle.ts                       # Oracle connection pool
├── services/
│   ├── financialMetrics.ts        # Financial metrics calculation
│   └── geniusClosing.ts           # Genius closing procedure
└── workflows/
    └── dailyClosing.ts            # Daily closing workflow definition
```

## Fitur & Keunggulan

### ✅ Background Job Execution

- **No Timeout Issues**: Oracle job berjalan sebagai DBMS_SCHEDULER job (fire-and-forget)
- Workflow langsung selesai setelah submit job tanpa menunggu 6 jam
- Job tracking tersedia via `checkOracleJobStatus` handler

### ✅ Durable Execution

- Workflow otomatis retry jika terjadi failure
- State Management: Progress disimpan dan bisa dilanjutkan setelah crash
- Monitoring: Lihat status workflow di Restate UI

### ✅ Oracle Job Status Tracking

- Check job status kapan saja dengan `checkOracleJobStatus`
- Status: RUNNING, SUCCEEDED, COMPLETED, FAILED
- Includes start time, duration, and error messages

## How It Works

1. **Submit Workflow** → Creates Oracle DBMS_SCHEDULER job
2. **Job Runs in Background** → Oracle handles execution (up to 6 hours)
3. **Workflow Completes** → Returns immediately with `jobName`
4. **Track Progress** → Call `checkOracleJobStatus` with `jobName`

## Notes

- Workflow menggunakan `DBMS_SCHEDULER.CREATE_JOB` untuk submit Oracle procedure
- Job berjalan di Oracle server, tidak blocking Restate workflow
- Financial metrics tetap berjalan di workflow (quick execution)
- Default `userId` adalah `"ASK"` (dapat diubah melalui parameter)

## Oracle Connection Configuration

Konfigurasi Oracle mengikuti best practices dari [node-oracledb documentation](https://node-oracledb.readthedocs.io/en/latest/user_guide/connection_handling.html):

1. **Separate credentials**: User, password, dan connection string dipisahkan untuk keamanan dan fleksibilitas
2. **Connect Descriptor format**: Menggunakan TNS connect descriptor untuk konfigurasi lengkap:
   ```
   (DESCRIPTION=(ADDRESS=(PROTOCOL=tcp)(HOST=host)(PORT=port))(CONNECT_DATA=(SERVICE_NAME=service)))
   ```
3. **Connection pooling**: Menggunakan connection pool untuk efisiensi dengan konfigurasi:
   - `poolMin`: 2 connections minimum
   - `poolMax`: 10 connections maximum
   - `poolIncrement`: 2 connections per scale
   - `poolTimeout`: 60 seconds for idle connections

### Alternative Connection String Formats

Node-oracledb mendukung beberapa format connection string:

1. **Easy Connect** (simple):

   ```
   ORACLE_CONNECT_STRING=aws3.tob-insurance.com:1521/ORCL
   ```

2. **Connect Descriptor** (current, recommended for complex configs):

   ```
   ORACLE_CONNECT_STRING=(DESCRIPTION=(ADDRESS=(PROTOCOL=tcp)(HOST=aws3.tob-insurance.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=ORCL)))
   ```

3. **TNS Alias** (requires tnsnames.ora file):
   ```
   ORACLE_CONNECT_STRING=prod_db
   ```

Untuk production, format Connect Descriptor direkomendasikan karena:

- Support untuk retry logic dan failover
- Dapat menambahkan multiple addresses untuk high availability
- Lebih jelas dan explicit dalam konfigurasi

### Oracle Thick Mode vs Thin Mode

**Error NJS-138** berarti Oracle Database versi Anda tidak didukung oleh Thin mode (hanya support Oracle DB 12.1+).

**Solusi**: Install Oracle Instant Client untuk menggunakan Thick mode:

1. **Download Oracle Instant Client**:

   - Windows: https://www.oracle.com/database/technologies/instant-client/winx64-downloads.html
   - Linux: https://www.oracle.com/database/technologies/instant-client/linux-x86-64-downloads.html
   - macOS: https://www.oracle.com/database/technologies/instant-client/macos-intel-x86-downloads.html

2. **Install dan Setup**:

   Windows:

   ```cmd
   # Extract ke C:\oracle\instantclient_19_x
   # Tambahkan ke PATH
   setx PATH "%PATH%;C:\oracle\instantclient_19_x"
   ```

   Linux/macOS:

   ```bash
   # Extract dan tambahkan ke PATH
   export LD_LIBRARY_PATH=/opt/oracle/instantclient_19_x:$LD_LIBRARY_PATH
   ```

3. **Restart aplikasi** - Thick mode akan otomatis aktif jika Instant Client terdeteksi

**Mode Detection**:

- ✅ Thick mode enabled - Mendukung semua versi Oracle Database (termasuk 10g, 11g)
- ⚠️ Running in Thin mode - Hanya untuk Oracle Database 12.1+

**Cek Versi Oracle Database**:

```sql
-- Connect ke Oracle dan jalankan:
SELECT * FROM v$version;
```

**Supported Versions**:

- Thin mode: Oracle Database 12.1, 12.2, 18c, 19c, 21c, 23c
- Thick mode: Oracle Database 10.2, 11.2, dan semua versi di atas

### Oracle Stored Procedure Details

Workflow ini memanggil Oracle stored procedure **`Package_Rpt_Ac_Fi806.get_master_data`** untuk proses closing Genius:

**Procedure Signature:**

```sql
Package_Rpt_Ac_Fi806.get_master_data(
  p_year          IN  VARCHAR2,   -- Tahun (4 digit): "2025"
  p_from_month    IN  VARCHAR2,   -- Bulan awal: "11"
  p_to_month      IN  VARCHAR2,   -- Bulan akhir: "11"
  p_userid        IN  VARCHAR2,   -- User ID: "SYS" atau user lain
  p_status        OUT VARCHAR2,   -- Output status: "1" = success, "0" = failed
  p_error_message OUT VARCHAR2    -- Output error message (max 100 chars)
)
```

**Input Parameters:**

- Date `"2025-11-24"` dipecah menjadi:
  - `p_year`: `"2025"`
  - `p_from_month`: `"11"`
  - `p_to_month`: `"11"`
- `userId` dari workflow input (default: `"SYS"`)

**Output Parameters:**

- `p_status`: `"1"` jika berhasil, `"0"` jika gagal
- `p_error_message`: Pesan error jika ada masalah

**Success Criteria:**
Workflow dianggap berhasil jika `p_status === "1"`
