import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPostgresClient } from "../../infrastructure/database/postgres.js";
import logger from "../../utils/logger.js";

const PND_AGG_TABLE = "pnd_agg";

const PND_AGG_INIT_SQL = readFileSync(
  join(import.meta.dirname, "pnd-agg-init.sql"),
  "utf-8"
);

const PND_AGG_INCREMENTAL_SQL = `
INSERT INTO ${PND_AGG_TABLE} AS target
SELECT
  pol_office, pol_subclass, pol_resv, pol_year, pol_month,
  pol_sequence, pol_end_no, pol_note_no,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code IN ('DPRM','CPRM','RPRM')), 0) AS premium,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code IN ('DDSC','CDIS','CDSC','DDS1')), 0) AS discount,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code IN ('DCOM','CCOM','MCOM','RCOM','DBKG')), 0) AS commission,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code = 'DVAT'), 0) AS vat,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code = 'DW21'), 0) AS w21,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code = 'DWTX'), 0) AS wtx,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code = 'COST'), 0) AS cost,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code = 'STMP'), 0) AS stamp,
  SUM(pol_note_trn_amount) AS total,
  NOW() AS last_updated
FROM policy_note_detail
WHERE pol_note_trn_code IN ('DPRM','CPRM','RPRM','DDSC','CDIS','CDSC','DDS1','DCOM','CCOM','MCOM','RCOM','DBKG','DVAT','DW21','DWTX','COST','STMP')
  AND pol_resv = '00'
  AND mod_date >= $1
GROUP BY pol_office, pol_subclass, pol_resv, pol_year, pol_month, pol_sequence, pol_end_no, pol_note_no
ON CONFLICT (pol_office, pol_subclass, pol_resv, pol_year, pol_month, pol_sequence, pol_end_no, pol_note_no)
DO UPDATE SET
  premium = target.premium + EXCLUDED.premium,
  discount = target.discount + EXCLUDED.discount,
  commission = target.commission + EXCLUDED.commission,
  vat = target.vat + EXCLUDED.vat,
  w21 = target.w21 + EXCLUDED.w21,
  wtx = target.wtx + EXCLUDED.wtx,
  cost = target.cost + EXCLUDED.cost,
  stamp = target.stamp + EXCLUDED.stamp,
  total = target.total + EXCLUDED.total,
  last_updated = NOW();
`;

const PND_AGG_FULL_REFRESH_SQL = `
INSERT INTO ${PND_AGG_TABLE} AS target
SELECT
  pol_office, pol_subclass, pol_resv, pol_year, pol_month,
  pol_sequence, pol_end_no, pol_note_no,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code IN ('DPRM','CPRM','RPRM')), 0) AS premium,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code IN ('DDSC','CDIS','CDSC','DDS1')), 0) AS discount,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code IN ('DCOM','CCOM','MCOM','RCOM','DBKG')), 0) AS commission,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code = 'DVAT'), 0) AS vat,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code = 'DW21'), 0) AS w21,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code = 'DWTX'), 0) AS wtx,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code = 'COST'), 0) AS cost,
  COALESCE(SUM(pol_note_trn_amount) FILTER (WHERE pol_note_trn_code = 'STMP'), 0) AS stamp,
  SUM(pol_note_trn_amount) AS total,
  NOW() AS last_updated
FROM policy_note_detail
WHERE pol_note_trn_code IN ('DPRM','CPRM','RPRM','DDSC','CDIS','CDSC','DDS1','DCOM','CCOM','MCOM','RCOM','DBKG','DVAT','DW21','DWTX','COST','STMP')
  AND pol_resv = '00'
GROUP BY pol_office, pol_subclass, pol_resv, pol_year, pol_month, pol_sequence, pol_end_no, pol_note_no
ON CONFLICT (pol_office, pol_subclass, pol_resv, pol_year, pol_month, pol_sequence, pol_end_no, pol_note_no)
DO UPDATE SET
  premium = EXCLUDED.premium,
  discount = EXCLUDED.discount,
  commission = EXCLUDED.commission,
  vat = EXCLUDED.vat,
  w21 = EXCLUDED.w21,
  wtx = EXCLUDED.wtx,
  cost = EXCLUDED.cost,
  stamp = EXCLUDED.stamp,
  total = EXCLUDED.total,
  last_updated = NOW();
`;

export async function initPndAgg(): Promise<void> {
  const client = getPostgresClient();
  const conn = await client.pool.connect();

  try {
    logger.info({ component: "Pipeline" }, "Initializing pnd_agg table...");
    await conn.query(PND_AGG_INIT_SQL);
    logger.info({ component: "Pipeline" }, "pnd_agg table initialized");
  } finally {
    conn.release();
  }
}

export async function refreshPndAgg(
  lastRefresh: Date,
  fullRefresh = false
): Promise<{ rowsProcessed: number }> {
  const client = getPostgresClient();
  const conn = await client.pool.connect();

  try {
    const startTime = Date.now();

    if (fullRefresh) {
      logger.info({ component: "Pipeline" }, "Full refresh of pnd_agg...");
      await conn.query("TRUNCATE TABLE pnd_agg");
      const result = await conn.query(PND_AGG_FULL_REFRESH_SQL);
      const duration = Date.now() - startTime;
      logger.info(
        { component: "Pipeline", rows: result.rowCount, duration },
        "pnd_agg full refresh completed"
      );
      return { rowsProcessed: result.rowCount ?? 0 };
    }

    logger.info(
      { component: "Pipeline", since: lastRefresh.toISOString() },
      "Incremental refresh of pnd_agg..."
    );
    const result = await conn.query(PND_AGG_INCREMENTAL_SQL, [lastRefresh]);
    const duration = Date.now() - startTime;
    logger.info(
      { component: "Pipeline", rows: result.rowCount, duration },
      "pnd_agg incremental refresh completed"
    );
    return { rowsProcessed: result.rowCount ?? 0 };
  } finally {
    conn.release();
  }
}

export async function getLastPndAggRefresh(): Promise<Date | null> {
  const client = getPostgresClient();
  const conn = await client.pool.connect();

  try {
    const result = await conn.query(
      "SELECT MAX(last_updated) as last_refresh FROM pnd_agg"
    );
    return result.rows[0]?.last_refresh ?? null;
  } finally {
    conn.release();
  }
}
