# Troubleshooting Guide

## PostgreSQL Financial Metrics Calculation Errors

### Error: "null value in column 'financial_metric_code' violates not-null constraint"

**Penyebab:**
Function `financial_report.calculate_financial_metrics` mencoba insert data dengan `financial_metric_code` yang NULL.

**Solusi:**

1. **Check Calculation Run Status**

   ```sql
   -- Query untuk melihat detail run yang failed
   SELECT * FROM financial_report.calculation_runs
   WHERE id = 'YOUR_RUN_ID_HERE'
   ORDER BY started_at DESC;

   -- Query untuk melihat error details
   SELECT * FROM financial_report.calculation_errors
   WHERE run_id = 'YOUR_RUN_ID_HERE';
   ```

2. **Check Step yang Gagal**
   Lihat `completed_steps` di table `calculation_runs`:

   - Step 0: Belum mulai
   - Step 1: `_extract_actuals_from_trial_balance` - Extract dari trial balance
   - Step 2: `_calculate_special_reserves` - Calculate reserves
   - Step 3: `_aggregate_metrics_by_dimensions` (ACTUAL) - Aggregate actual metrics
   - Step 4: `_calculate_derived_metrics_simple` - Calculate derived metrics
   - Step 5: `_aggregate_metrics_by_dimensions` (CALCULATED) - Aggregate calculated metrics

3. **Debug Helper Functions**
   Check setiap step function secara manual:

   ```sql
   -- Test step 1
   SELECT financial_report._extract_actuals_from_trial_balance(2025, 8, gen_random_uuid());

   -- Test step 2
   SELECT financial_report._calculate_special_reserves(2025, 8, gen_random_uuid());

   -- Test step 3
   SELECT financial_report._aggregate_metrics_by_dimensions(2025, 8, 'ACTUAL');

   -- Test step 4
   SELECT financial_report._calculate_derived_metrics_simple(2025, 8, gen_random_uuid());

   -- Test step 5
   SELECT financial_report._aggregate_metrics_by_dimensions(2025, 8, 'CALCULATED');
   ```

4. **Kemungkinan Root Cause:**

   - Data di trial balance tidak lengkap untuk bulan tersebut
   - Mapping `financial_metric_code` tidak ada untuk beberapa account
   - Logic di `_calculate_derived_metrics_simple` menghasilkan NULL

5. **Temporary Workaround:**
   Skip financial metrics calculation sementara:
   ```bash
   curl http://localhost:8080/DailyClosing/2025-08-24/run/send \
     --json '{"date": "2025-08-24", "skipFinancialMetrics": true}'
   ```

### Error: "Connection terminated unexpectedly"

**Penyebab:**
PostgreSQL connection terputus saat idle atau karena network issue.

**Yang Sudah Dilakukan:**

- ✅ Auto-retry dengan exponential backoff (3x retry)
- ✅ Connection pool tidak exit aplikasi saat connection error
- ✅ Fresh connection untuk setiap calculation request

**Monitoring:**
Connection pool akan otomatis recreate connection yang failed. Cek log untuk:

```
⚠️ Unexpected error on idle PostgreSQL client: ...
   Connection will be removed from pool and recreated on next request.
```

## Oracle Genius Closing

### Timeout Issues

**Konfigurasi Timeout:**
Workflow sudah dikonfigurasi dengan:

- `abortTimeout: { hours: 7 }` - Max 7 jam untuk complete
- `inactivityTimeout: { hours: 7 }` - Max 7 jam idle time

**Check Stored Procedure:**

```sql
-- Check running sessions di Oracle
SELECT sid, serial#, username, status, program, sql_id
FROM v$session
WHERE username = 'ACPDB'
AND status = 'ACTIVE';

-- Check long running operations
SELECT * FROM v$session_longops
WHERE username = 'ACPDB'
AND time_remaining > 0;
```

## Workflow Status Checking

### Via Restate UI

Open: http://localhost:9070

### Via API

```bash
# Get workflow status
curl http://localhost:8080/DailyClosing/2025-08-24/getStatus

# Get invocation details (requires invocation ID)
curl http://localhost:9070/invocations/inv_YOUR_INVOCATION_ID
```

### Check PostgreSQL Run Status

```bash
# Ambil runId dari response workflow
# Kemudian query status:
SELECT * FROM financial_report.calculation_runs
WHERE year = 2025 AND month = 8
ORDER BY started_at DESC
LIMIT 5;
```

## Common Issues

### 1. Workflow Stuck in "Running" State

**Check:**

- Restate Server logs
- Service logs (npm run dev output)
- Database connection status

**Solution:**

- Workflow akan auto-retry on failure
- Check logs untuk error messages
- Jika perlu, kill dan restart workflow

### 2. Oracle Procedure Takes Too Long

**Expected:**

- Normal: 2-4 jam untuk monthly closing
- Maximum: 6 jam (ada timeout 7 jam)

**If Timeout:**

- Oracle akan tetap execute sampai selesai
- Workflow mungkin fail, tapi data Oracle tetap diproses
- Check di Oracle langsung untuk verifikasi data

### 3. Data Integrity Errors

**Postgres Error Codes:**

- `23502` - NOT NULL violation
- `23503` - Foreign key violation
- `23505` - Unique constraint violation
- `23514` - Check constraint violation

**Handling:**

- Error ini **tidak** di-retry (by design)
- Fix data issue di source
- Rerun workflow setelah data fixed

## Log Locations

- **Service Logs**: Console output dari `npm run dev`
- **Restate Logs**: Prefixed dengan `[restate]`
- **PostgreSQL Logs**: Server logs di PostgreSQL host
- **Oracle Logs**: Server logs di Oracle host

## Getting Help

1. Check this troubleshooting guide
2. Check Restate UI for invocation details
3. Check calculation_runs and calculation_errors tables
4. Check service console logs for detailed error messages
