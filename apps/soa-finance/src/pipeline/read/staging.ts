import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDataIntegrityError } from "@restate-tob/postgres";
import { TerminalError } from "@restatedev/restate-sdk";
import { getPostgresClient } from "../../infrastructure/database/postgres.js";
import { formatTimePeriod } from "../../utils/formatter/date.formatter.js";
import logger from "../../utils/logger.js";
import { getLastPndAggRefresh, initPndAgg, refreshPndAgg } from "./pnd-agg.js";

const BUILD_TABLE = "soa_pipeline_staging_build";
const ACTIVE_TABLE = "soa_pipeline_staging";

const SOA_QUERY_TEMPLATE = readFileSync(
  join(import.meta.dirname, "staging.sql"),
  "utf-8"
);

const buildQuery = (buildTable: string): string =>
  SOA_QUERY_TEMPLATE.replace(/__BUILD_TABLE__/g, buildTable);

async function ensurePndAggFresh(): Promise<void> {
  await initPndAgg();

  const lastRefresh = await getLastPndAggRefresh();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (!lastRefresh || lastRefresh < oneDayAgo) {
    logger.info(
      { component: "Pipeline", lastRefresh },
      "pnd_agg needs full refresh"
    );
    await refreshPndAgg(new Date(0), true);
  } else {
    logger.info(
      { component: "Pipeline", lastRefresh },
      "pnd_agg is fresh, running incremental refresh"
    );
    await refreshPndAgg(lastRefresh, false);
  }
}

export async function refreshStaging(asAtDate: Date): Promise<void> {
  const client = getPostgresClient();
  const period = formatTimePeriod(asAtDate);
  const conn = await client.pool.connect();

  try {
    logger.info({ component: "Pipeline" }, "Refreshing staging table...");

    await ensurePndAggFresh();

    await conn.query("SET work_mem = '512MB'");
    await conn.query("SET hash_mem_multiplier = '4.0'");
    await conn.query("SET jit = off");
    await conn.query("SET max_parallel_workers_per_gather = '4'");
    await conn.query("SET parallel_tuple_cost = 0.01");
    await conn.query("SET parallel_setup_cost = 100");

    await conn.query(`DROP TABLE IF EXISTS ${BUILD_TABLE}`);
    await conn.query(
      `CREATE TABLE ${BUILD_TABLE} (LIKE ${ACTIVE_TABLE} INCLUDING DEFAULTS)`
    );
    await conn.query(buildQuery(BUILD_TABLE), [asAtDate, period]);

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

    const errorCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (isDataIntegrityError(errorCode)) {
      throw new TerminalError(`Pipeline data integrity error: ${errorMessage}`);
    }

    logger.error(
      { component: "Pipeline", err: error },
      "Staging refresh failed"
    );
    throw error;
  } finally {
    await conn.query("RESET work_mem").catch(() => undefined);
    await conn.query("RESET hash_mem_multiplier").catch(() => undefined);
    await conn.query("RESET jit").catch(() => undefined);
    await conn
      .query("RESET max_parallel_workers_per_gather")
      .catch(() => undefined);
    await conn.query("RESET parallel_tuple_cost").catch(() => undefined);
    await conn.query("RESET parallel_setup_cost").catch(() => undefined);
    conn.release();
  }
}
