import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPostgresClient } from "../../infrastructure/database/postgres.js";
import { formatTimePeriod } from "../../utils/formatter/date.formatter.js";
import logger from "../../utils/logger.js";

const BUILD_TABLE = "soa_pipeline_staging_build";
const ACTIVE_TABLE = "soa_pipeline_staging";

const SOA_QUERY_TEMPLATE = readFileSync(
  join(import.meta.dirname, "staging.sql"),
  "utf-8"
);

const buildQuery = (buildTable: string): string =>
  SOA_QUERY_TEMPLATE.replace(/__BUILD_TABLE__/g, buildTable);

export async function refreshStaging(asAtDate: Date): Promise<void> {
  const client = getPostgresClient();
  const period = formatTimePeriod(asAtDate);
  const conn = await client.pool.connect();

  try {
    logger.info({ component: "Pipeline" }, "Refreshing staging table...");

    await conn.query("SET work_mem = '512MB'");
    await conn.query("SET hash_mem_multiplier = '4.0'");
    await conn.query("SET jit = off");
    await conn.query("SET max_parallel_workers_per_gather = '1'");

    // Recreate build table (it was renamed away in the previous swap)
    await conn.query(`DROP TABLE IF EXISTS ${BUILD_TABLE}`);
    await conn.query(
      `CREATE UNLOGGED TABLE ${BUILD_TABLE} (LIKE ${ACTIVE_TABLE} INCLUDING DEFAULTS)`
    );
    await conn.query(`TRUNCATE TABLE ${BUILD_TABLE}`);
    await conn.query(buildQuery(BUILD_TABLE), [asAtDate, period]);

    // Convert to LOGGED so it survives failover and replicates to standby
    await conn.query(`ALTER TABLE ${BUILD_TABLE} SET LOGGED`);

    await conn.query(
      `CREATE INDEX ON ${BUILD_TABLE} (distribution_code, branch)`
    );
    await conn.query(`ANALYZE ${BUILD_TABLE}`);

    await conn.query("BEGIN");
    await conn.query(`DROP TABLE IF EXISTS ${ACTIVE_TABLE}_old`);
    await conn.query(
      `ALTER TABLE IF EXISTS ${ACTIVE_TABLE} RENAME TO ${ACTIVE_TABLE}_old`
    );
    await conn.query(`ALTER TABLE ${BUILD_TABLE} RENAME TO ${ACTIVE_TABLE}`);
    await conn.query("COMMIT");
    await conn.query(`DROP TABLE IF EXISTS ${ACTIVE_TABLE}_old`);
  } catch (error: unknown) {
    await conn.query("ROLLBACK").catch((rollbackErr) => {
      logger.warn(
        { component: "Pipeline", err: rollbackErr },
        "Rollback error"
      );
    });
    logger.error(
      { component: "Pipeline", err: error },
      "Staging refresh failed"
    );
    throw error;
  } finally {
    conn.release();
  }
}
