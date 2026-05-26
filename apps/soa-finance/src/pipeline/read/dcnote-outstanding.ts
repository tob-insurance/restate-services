import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPostgresClient } from "../../infrastructure/database/postgres.js";
import logger from "../../utils/logger.js";

const OUTSTANDING_TABLE = "dcnote_outstanding";

const OUTSTANDING_INIT_SQL = readFileSync(
  join(import.meta.dirname, "dcnote-outstanding-init.sql"),
  "utf-8"
);

const OUTSTANDING_INCREMENTAL_SQL = `
INSERT INTO ${OUTSTANDING_TABLE} AS target
SELECT
  dn.dc_office, dn.dc_year, dn.dc_month, dn.dc_mode, dn.dc_seq,
  dn.pol_office, dn.pol_subclass, dn.pol_year, dn.pol_month,
  dn.pol_seq, dn.pol_end_no, dn.pol_notes_no,
  dn.orig_amount,
  COALESCE(fst.amt, 0) AS settled_amount,
  (ABS(dn.orig_amount) - ABS(COALESCE(fst.amt, 0))) > 1 AS is_outstanding,
  NOW() AS last_updated
FROM dcnote dn
LEFT JOIN (
  SELECT dc_office, dc_year, dc_month, dc_mode, dc_seq,
    SUM(fn_orig_amt) AS amt
  FROM financial_settle
  WHERE post_date < NOW() + INTERVAL '1 day'
  GROUP BY dc_office, dc_year, dc_month, dc_mode, dc_seq
) fst ON dn.dc_office = fst.dc_office AND dn.dc_year = fst.dc_year
  AND dn.dc_month = fst.dc_month AND dn.dc_mode = fst.dc_mode AND dn.dc_seq = fst.dc_seq
WHERE dn.dc_mode IN ('01','02','03','04','05')
  AND dn.pol_office IS NOT NULL
  AND dn.mod_date >= $1
ON CONFLICT (dc_office, dc_year, dc_month, dc_mode, dc_seq)
DO UPDATE SET
  orig_amount = EXCLUDED.orig_amount,
  settled_amount = EXCLUDED.settled_amount,
  is_outstanding = EXCLUDED.is_outstanding,
  last_updated = NOW();
`;

const OUTSTANDING_FULL_REFRESH_SQL = `
INSERT INTO ${OUTSTANDING_TABLE} AS target
SELECT
  dn.dc_office, dn.dc_year, dn.dc_month, dn.dc_mode, dn.dc_seq,
  dn.pol_office, dn.pol_subclass, dn.pol_year, dn.pol_month,
  dn.pol_seq, dn.pol_end_no, dn.pol_notes_no,
  dn.orig_amount,
  COALESCE(fst.amt, 0) AS settled_amount,
  (ABS(dn.orig_amount) - ABS(COALESCE(fst.amt, 0))) > 1 AS is_outstanding,
  NOW() AS last_updated
FROM dcnote dn
LEFT JOIN (
  SELECT dc_office, dc_year, dc_month, dc_mode, dc_seq,
    SUM(fn_orig_amt) AS amt
  FROM financial_settle
  WHERE post_date < NOW() + INTERVAL '1 day'
  GROUP BY dc_office, dc_year, dc_month, dc_mode, dc_seq
) fst ON dn.dc_office = fst.dc_office AND dn.dc_year = fst.dc_year
  AND dn.dc_month = fst.dc_month AND dn.dc_mode = fst.dc_mode AND dn.dc_seq = fst.dc_seq
WHERE dn.dc_mode IN ('01','02','03','04','05')
  AND dn.pol_office IS NOT NULL
ON CONFLICT (dc_office, dc_year, dc_month, dc_mode, dc_seq)
DO UPDATE SET
  orig_amount = EXCLUDED.orig_amount,
  settled_amount = EXCLUDED.settled_amount,
  is_outstanding = EXCLUDED.is_outstanding,
  last_updated = NOW();
`;

export async function initOutstanding(): Promise<void> {
  const client = getPostgresClient();
  const conn = await client.pool.connect();

  try {
    logger.info(
      { component: "Pipeline" },
      "Initializing dcnote_outstanding table..."
    );
    await conn.query(OUTSTANDING_INIT_SQL);
    logger.info(
      { component: "Pipeline" },
      "dcnote_outstanding table initialized"
    );
  } finally {
    conn.release();
  }
}

export async function refreshOutstanding(
  lastRefresh: Date,
  fullRefresh = false
): Promise<{ rowsProcessed: number }> {
  const client = getPostgresClient();
  const conn = await client.pool.connect();

  try {
    const startTime = Date.now();

    if (fullRefresh) {
      logger.info(
        { component: "Pipeline" },
        "Full refresh of dcnote_outstanding..."
      );
      await conn.query("TRUNCATE TABLE dcnote_outstanding");
      const result = await conn.query(OUTSTANDING_FULL_REFRESH_SQL);
      const duration = Date.now() - startTime;
      logger.info(
        { component: "Pipeline", rows: result.rowCount, duration },
        "dcnote_outstanding full refresh completed"
      );
      return { rowsProcessed: result.rowCount ?? 0 };
    }

    logger.info(
      { component: "Pipeline", since: lastRefresh.toISOString() },
      "Incremental refresh of dcnote_outstanding..."
    );
    const result = await conn.query(OUTSTANDING_INCREMENTAL_SQL, [lastRefresh]);
    const duration = Date.now() - startTime;
    logger.info(
      { component: "Pipeline", rows: result.rowCount, duration },
      "dcnote_outstanding incremental refresh completed"
    );
    return { rowsProcessed: result.rowCount ?? 0 };
  } finally {
    conn.release();
  }
}

export async function getLastOutstandingRefresh(): Promise<Date | null> {
  const client = getPostgresClient();
  const conn = await client.pool.connect();

  try {
    const result = await conn.query(
      "SELECT MAX(last_updated) as last_refresh FROM dcnote_outstanding"
    );
    return result.rows[0]?.last_refresh ?? null;
  } finally {
    conn.release();
  }
}
