import {
  type ObjectContext,
  object,
  TerminalError,
} from "@restatedev/restate-sdk";
import { parseEnvInt } from "../constants/environment.js";
import { getPostgresClient } from "../infrastructure/database/postgres.js";

// Refresh state tracked in Virtual Object
export interface RefreshState {
  lastRefresh: string; // ISO timestamp of the last completed refresh
  status: "idle" | "running" | "completed" | "failed";
  steps: Record<
    string,
    {
      status: "pending" | "running" | "completed" | "failed";
      rowsAffected: number;
      durationMs: number;
      error?: string;
    }
  >;
}

interface RefreshResult {
  durationMs: number;
  rowsAffected: number;
}

// Refresh queries can run far longer than the connection pool's default
// statement_timeout (5 min) — a full rebuild aggregates tens of millions of
// rows. Each step runs on a dedicated connection with a raised timeout plus
// the same planner tuning the staging build uses, which steers the large
// aggregations onto parallel seq scans + parallel hash aggregates instead of
// single-threaded index scans with random heap I/O.
const REFRESH_STATEMENT_TIMEOUT_MS = 7_200_000; // 2 hours

// A full rebuild keeps a single ctx.run busy for many minutes. Without a raised
// inactivity timeout Restate aborts the attempt and replays it, leaving the
// original query running orphaned in Postgres while a duplicate starts — they
// pile up and starve each other. Must comfortably exceed the statement timeout.
const REFRESH_INACTIVITY_TIMEOUT_HOURS = parseEnvInt(
  "SOA_REFRESH_INACTIVITY_TIMEOUT_HOURS",
  3
);

// Errors where a retry can only repeat the failure: broken SQL, bad data,
// constraint violations, auth, or a statement that already burned through its
// 2-hour timeout. Everything else (connection loss, deadlock, resource
// pressure) is left to Restate's retry — completed steps replay from the
// journal and execution resumes at the failed step.
function isTerminalRefreshError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== "string") {
    return false;
  }
  return (
    code === "57014" || // statement_timeout / query canceled
    code.startsWith("22") || // data exception
    code.startsWith("23") || // integrity constraint violation
    code.startsWith("28") || // invalid authorization
    code.startsWith("42") // syntax error / undefined object
  );
}

const REFRESH_SESSION_SETTINGS = [
  `SET statement_timeout = ${REFRESH_STATEMENT_TIMEOUT_MS}`,
  "SET work_mem = '512MB'",
  "SET hash_mem_multiplier = '4.0'",
  "SET jit = off",
  "SET max_parallel_workers_per_gather = '4'",
  "SET parallel_tuple_cost = 0.01",
  "SET parallel_setup_cost = 100",
  // The fin-settle aggregate groups ~28M near-unique rows. A HashAggregate
  // builds a ~28M-entry hash table that spills to disk, and the planner
  // underestimates the group count (multi-column independence assumption), so
  // it keeps picking it. Force the streaming GroupAggregate over the
  // already-sorted index instead — constant memory, no spill. The other steps
  // only aggregate inside per-row lateral probes (a handful of rows each), so
  // this is a no-op for them (it does not affect hash joins).
  "SET enable_hashagg = off",
  // Speed up the bulk index/PK builds on the freshly rebuilt table.
  "SET maintenance_work_mem = '1GB'",
  "SET max_parallel_maintenance_workers = '4'",
];

// Acquire a dedicated connection with the refresh session settings applied.
async function getRefreshConnection() {
  const conn = await getPostgresClient().pool.connect();
  for (const stmt of REFRESH_SESSION_SETTINGS) {
    await conn.query(stmt);
  }
  return conn;
}

// Index/constraint to (re)build on a full rebuild's fresh table.
interface RebuildIndex {
  // Comma-separated column list.
  columns: string;
  // Final name the index/constraint carries on the live table.
  name: string;
  // When true, build a PRIMARY KEY (sets the columns NOT NULL + unique index);
  // otherwise a plain secondary index.
  primaryKey?: boolean;
}

interface MaterializeOptions {
  // Indexes/constraints to rebuild on the fresh table before the swap.
  indexes?: RebuildIndex[];
  // Physical row order for the CTAS. Lay rows out in the order the read path
  // filters on so each consumer's rows are contiguous.
  orderBy?: string;
}

// Materialize an aggregate/staging table from a SELECT: build into a side
// table (CREATE TABLE AS — parallelizes the scan/aggregate, unlike
// INSERT ... SELECT), bulk-build its indexes, then swap it in atomically.
// This writes the rows once and builds indexes in bulk instead of maintaining
// them row by row. The live table keeps an ACCESS EXCLUSIVE lock only for the
// instant of the rename, not for the whole multi-minute rebuild.
async function materialize(
  table: string,
  selectSql: string,
  options: MaterializeOptions
): Promise<{ rowCount: number | null }> {
  const conn = await getRefreshConnection();
  try {
    return await rebuildAndSwap(conn, table, selectSql, options);
  } finally {
    conn.release();
  }
}

// Build a fresh table, bulk-build its indexes, swap it in atomically.
async function rebuildAndSwap(
  conn: RefreshConnection,
  table: string,
  selectSql: string,
  options: MaterializeOptions
): Promise<{ rowCount: number | null }> {
  const buildTable = `${table}_build`;
  const indexes = options.indexes ?? [];

  // Replay-safe: a previously aborted attempt may have left the build table
  // behind. Dropping it first makes the rebuild idempotent under Restate
  // retries — the swap below rebuilds from the (unchanged) source either way.
  await conn.query(`DROP TABLE IF EXISTS ${buildTable}`);

  // A fresh table only carries privileges from the owner's default ACL —
  // explicit per-table GRANTs on the live table (reporting/read-only
  // roles) would silently disappear in the swap. Snapshot them now and
  // re-apply to the build table below.
  const grants = await conn.query(
    `SELECT a.privilege_type,
                CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee
         FROM pg_class c, aclexplode(c.relacl) a
         WHERE c.oid = to_regclass($1)`,
    [table]
  );

  // Single parallel write into an index-less table.
  const buildResult = await conn.query(
    `CREATE TABLE ${buildTable} AS ${selectSql}${options.orderBy ? ` ORDER BY ${options.orderBy}` : ""}`
  );
  const rowsBuilt = buildResult.rowCount ?? 0;

  for (const grant of grants.rows) {
    await conn.query(
      `GRANT ${grant.privilege_type} ON ${buildTable} TO ${grant.grantee}`
    );
  }

  // Build indexes/constraints on the private build table — bulk-built here,
  // before the swap, so neither the build cost nor the table scan holds a
  // lock any reader cares about. Temporary "_build" suffix avoids colliding
  // with the live table's index names (still present until the swap).
  for (const idx of indexes) {
    if (idx.primaryKey) {
      await conn.query(
        `ALTER TABLE ${buildTable} ADD CONSTRAINT ${idx.name}_build PRIMARY KEY (${idx.columns})`
      );
    } else {
      await conn.query(
        `CREATE INDEX ${idx.name}_build ON ${buildTable} (${idx.columns})`
      );
    }
  }

  // Stats survive the rename (they key on the relation OID). Without this,
  // readers hitting the table right after the swap plan against an
  // unanalyzed table until autovacuum gets to it.
  await conn.query(`ANALYZE ${buildTable}`);

  // Atomic swap: only a DROP + RENAMEs, so the live table is locked just for
  // the instant the transaction commits.
  await conn.query("BEGIN");
  try {
    await conn.query(`DROP TABLE ${table}`);
    await conn.query(`ALTER TABLE ${buildTable} RENAME TO ${table}`);
    for (const idx of indexes) {
      if (idx.primaryKey) {
        // Renaming a PK/unique constraint also renames its backing index,
        // so this single statement handles both — no separate ALTER INDEX.
        await conn.query(
          `ALTER TABLE ${table} RENAME CONSTRAINT ${idx.name}_build TO ${idx.name}`
        );
      } else {
        await conn.query(`ALTER INDEX ${idx.name}_build RENAME TO ${idx.name}`);
      }
    }
    await conn.query("COMMIT");
  } catch (err) {
    await conn.query("ROLLBACK");
    throw err;
  }

  return { rowCount: rowsBuilt };
}

type RefreshConnection = Awaited<ReturnType<typeof getRefreshConnection>>;

// Every refresh rebuilds all three tables from source. Refresh only runs
// right before a scheduled batch (a handful of times per month), and a full
// rebuild takes minutes — an incremental path would save ~2 minutes per run
// while carrying a whole watermark-correctness surface (clock skew, partial
// group recomputes, changed-key propagation) and leaving hard deletes and
// master-data edits stale between its escalation intervals. Rebuilding from
// source heals both on every run by construction.
async function executeRefresh(
  ctx: ObjectContext,
  state: RefreshState
): Promise<{
  status: string;
  durationMs?: number;
  steps?: Record<string, unknown>;
}> {
  // No concurrent-refresh guard: virtual objects serialize handler executions
  // per key, so a second refresh queues behind the first. A state-based guard
  // would only ever fire after a killed invocation left status "running" — and
  // then it would block every future refresh.
  state.status = "running";
  state.steps = {};
  ctx.set("state", state);

  try {
    // ctx.date.now() is journaled: a replay reuses the original timestamp.
    const now = new Date(await ctx.date.now());

    // Sequential dependency chain: staging_unpaid joins soa_fin_settle_agg,
    // and pipeline_staging reads staging_unpaid (computing the note-detail
    // sums inline via lateral index probes), so each step needs its
    // predecessor — nothing is independent enough to run in parallel.
    state.steps.fin_settle_agg = {
      status: "running",
      rowsAffected: 0,
      durationMs: 0,
    };
    ctx.set("state", state);

    const step1Result = await ctx.run("refresh-fin-settle-agg", () =>
      refreshFinSettleAgg()
    );
    state.steps.fin_settle_agg = {
      status: "completed",
      rowsAffected: step1Result.rowsAffected,
      durationMs: step1Result.durationMs,
    };
    state.steps.staging_unpaid = {
      status: "running",
      rowsAffected: 0,
      durationMs: 0,
    };
    ctx.set("state", state);

    const step2Result = await ctx.run("refresh-staging-unpaid", () =>
      refreshStagingUnpaid()
    );
    state.steps.staging_unpaid = {
      status: "completed",
      rowsAffected: step2Result.rowsAffected,
      durationMs: step2Result.durationMs,
    };
    state.steps.pipeline_staging = {
      status: "running",
      rowsAffected: 0,
      durationMs: 0,
    };
    ctx.set("state", state);

    const step3Result = await ctx.run("refresh-pipeline-staging", () =>
      refreshPipelineStaging()
    );
    state.steps.pipeline_staging = {
      status: "completed",
      rowsAffected: step3Result.rowsAffected,
      durationMs: step3Result.durationMs,
    };

    // Update final state
    state.status = "completed";
    state.lastRefresh = now.toISOString();
    ctx.set("state", state);

    const totalDuration = Object.values(state.steps).reduce(
      (sum, step) => sum + step.durationMs,
      0
    );

    ctx.console.log(`Refresh completed in ${totalDuration}ms`);

    return {
      status: "completed",
      durationMs: totalDuration,
      steps: state.steps,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    if (isTerminalRefreshError(error)) {
      state.status = "failed";
      ctx.set("state", state);
      ctx.console.error(`Refresh failed (terminal): ${errorMessage}`);
      throw new TerminalError(`Refresh failed: ${errorMessage}`);
    }

    // Transient failure: rethrow as-is so Restate retries the invocation.
    // Completed steps replay from the journal; execution resumes at the
    // failed step. Status stays "running" — the refresh is still in flight.
    ctx.console.error(`Refresh step failed, retrying: ${errorMessage}`);
    throw error;
  }
}

export const SoaRefreshManager = object({
  name: "SoaRefreshManager",
  options: {
    inactivityTimeout: { hours: REFRESH_INACTIVITY_TIMEOUT_HOURS },
  },
  handlers: {
    // Rebuild all pipeline tables from source.
    refresh: async (ctx: ObjectContext) => {
      const state = (await ctx.get<RefreshState>("state")) ?? {
        lastRefresh: new Date(0).toISOString(),
        status: "idle",
        steps: {},
      };

      return executeRefresh(ctx, state);
    },

    // Get current refresh status
    getStatus: async (ctx: ObjectContext) => {
      const state = await ctx.get<RefreshState>("state");
      return (
        state ?? {
          lastRefresh: new Date(0).toISOString(),
          status: "idle",
          steps: {},
        }
      );
    },
  },
});

// Helper functions for each refresh step

// Settled amount per dc-note key, for all keys. Not prefilterable: every
// dcnote candidate needs its settled amount to decide unpaidness, and
// materializing keeps the planner from rebuilding the ~28M-group aggregate
// per hash-join worker. No predicates beyond dc_office IS NOT NULL, so the
// aggregate runs as a streaming index-only scan over idx_fin_settle_covering.
async function refreshFinSettleAgg(): Promise<RefreshResult> {
  const startTime = Date.now();

  const result = await materialize(
    "soa_fin_settle_agg",
    `
    SELECT dc_office, dc_year, dc_month, dc_mode, dc_seq, SUM(fn_orig_amt) AS amt
    FROM financial_settle
    WHERE dc_office IS NOT NULL
    GROUP BY dc_office, dc_year, dc_month, dc_mode, dc_seq
  `,
    {
      indexes: [
        {
          name: "soa_fin_settle_agg_pkey",
          columns: "dc_office, dc_year, dc_month, dc_mode, dc_seq",
          primaryKey: true,
        },
      ],
    }
  );

  return {
    rowsAffected: result.rowCount ?? 0,
    durationMs: Date.now() - startTime,
  };
}

// The prefilter: reduces ~28M dcnote candidates to the ~800K unpaid notes
// every later step works from. The PK doubles as a tripwire — a fan-out bug
// upstream would surface here as a constraint violation instead of silently
// duplicating staging rows.
async function refreshStagingUnpaid(): Promise<RefreshResult> {
  const startTime = Date.now();

  const result = await materialize(
    "soa_staging_unpaid",
    `
    SELECT
      dn.dc_office, dn.dc_year, dn.dc_month, dn.dc_mode, dn.dc_seq,
      dn.pol_office, dn.pol_subclass, dn.pol_year, dn.pol_month, dn.pol_seq as pol_sequence, dn.pol_end_no, dn.pol_notes_no as pol_note_no,
      dn.orig_amount, dn.currency, dn.dc_account_full_name, dn.dc_post_date,
      fst.amt as settled_amount
    FROM dcnote dn
    LEFT JOIN soa_fin_settle_agg fst ON dn.dc_office = fst.dc_office AND dn.dc_year = fst.dc_year AND dn.dc_month = fst.dc_month AND dn.dc_mode = fst.dc_mode AND dn.dc_seq = fst.dc_seq
    WHERE dn.dc_mode IN ('01','02','03','04','05')
      AND dn.pol_office IS NOT NULL
      AND (ABS(dn.orig_amount) - ABS(COALESCE(fst.amt, 0))) > 1
  `,
    {
      indexes: [
        {
          name: "soa_staging_unpaid_pkey",
          columns: "dc_office, dc_year, dc_month, dc_mode, dc_seq",
          primaryKey: true,
        },
      ],
    }
  );

  return {
    rowsAffected: result.rowCount ?? 0,
    durationMs: Date.now() - startTime,
  };
}

async function refreshPipelineStaging(): Promise<RefreshResult> {
  const startTime = Date.now();

  // The nine note-detail sums are computed inline (the pnd lateral below) as
  // index-only probes of idx_pnd_detail_covering, ~2 rows per group, instead
  // of pre-aggregating all ~28M policy_note_detail groups into a 5.9GB table
  // of which only ~3% was ever joined (measured: all 788K probes = 16s vs
  // 346s for the full aggregate). HAVING COUNT(*) > 0 keeps the former
  // inner-join semantics: staging rows with no qualifying note detail are
  // dropped, not emitted with zeroed sums.
  const result = await materialize(
    "soa_pipeline_staging",
    `
    SELECT
      mb.description as branch,
      dn.pol_subclass || '-' || dn.pol_office || '-' || dn.pol_month || '-' || dn.pol_year || '-' || dn.pol_sequence as policy_no,
      dn.pol_end_no,
      pm.alt_polno as contract_no,
      pmi.plat_no_1 || pmi.plat_no_2 || pmi.plat_no_3 as plat_no,
      pm.co_in_fac_ref_no,
      pm.fire_conjunction_pol,
      rl.lob_desc as lob,
      pm.source_of_business as sob,
      dn.dc_account_full_name,
      pm.insured_name,
      pm.distribution_name,
      pm.distribution_name2,
      pid.qq_name,
      pe.end_eff_date,
      pe.end_exp_date,
      pm.post_date,
      CURRENT_DATE - CASE WHEN pe.pol_end_no = '000' THEN pe.end_eff_date::date ELSE pe.end_post_date::date END as aging,
      dn.currency as curr,
      COALESCE(exc.the_rate, 1) as exch_rate,
      pe.end_reason,
      cm.acting_code,
      prp.tsi,
      pnd.premium as gp,
      pnd.discount as disc,
      pnd.commission as comm,
      pnd.vat as ppn,
      pnd.w21 as pph21,
      pnd.wtx as pph23,
      pnd.cost,
      pnd.stamp as stmp,
      pnd.total as nett_premium,
      pn.pol_inst_no || '/' || pn.pol_total_inst as inst_no,
      pn.due_date,
      dn.dc_office || '-' || dn.dc_month || '-' || dn.dc_mode || '-' || dn.dc_year || '-' || dn.dc_seq as dc_note,
      dn.orig_amount,
      pm.distribution_code
    FROM soa_staging_unpaid dn
    JOIN LATERAL (
      SELECT
        COALESCE(SUM(p.pol_note_trn_amount) FILTER (WHERE p.pol_note_trn_code IN ('DPRM','CPRM','RPRM')), 0) AS premium,
        COALESCE(SUM(p.pol_note_trn_amount) FILTER (WHERE p.pol_note_trn_code IN ('DDSC','CDIS','CDSC','DDS1')), 0) AS discount,
        COALESCE(SUM(p.pol_note_trn_amount) FILTER (WHERE p.pol_note_trn_code IN ('DCOM','CCOM','MCOM','RCOM','DBKG')), 0) AS commission,
        COALESCE(SUM(p.pol_note_trn_amount) FILTER (WHERE p.pol_note_trn_code = 'DVAT'), 0) AS vat,
        COALESCE(SUM(p.pol_note_trn_amount) FILTER (WHERE p.pol_note_trn_code = 'DW21'), 0) AS w21,
        COALESCE(SUM(p.pol_note_trn_amount) FILTER (WHERE p.pol_note_trn_code = 'DWTX'), 0) AS wtx,
        COALESCE(SUM(p.pol_note_trn_amount) FILTER (WHERE p.pol_note_trn_code = 'COST'), 0) AS cost,
        COALESCE(SUM(p.pol_note_trn_amount) FILTER (WHERE p.pol_note_trn_code = 'STMP'), 0) AS stamp,
        SUM(p.pol_note_trn_amount) AS total
      FROM policy_note_detail p
      WHERE p.pol_office = dn.pol_office
        AND p.pol_subclass = dn.pol_subclass
        AND p.pol_resv = '00'
        AND p.pol_year = dn.pol_year
        AND p.pol_month = dn.pol_month
        AND p.pol_sequence = dn.pol_sequence
        AND p.pol_end_no = dn.pol_end_no
        AND p.pol_note_no = dn.pol_note_no
        AND p.pol_note_trn_code IN ('DPRM','CPRM','RPRM','DDSC','CDIS','CDSC','DDS1','DCOM','CCOM','MCOM','RCOM','DBKG','DVAT','DW21','DWTX','COST','STMP')
      HAVING COUNT(*) > 0
    ) pnd ON TRUE
    JOIN policy_note pn ON dn.pol_office = pn.pol_office
      AND dn.pol_subclass = pn.pol_subclass 
      AND dn.pol_year = pn.pol_year 
      AND dn.pol_month = pn.pol_month 
      AND dn.pol_sequence = pn.pol_sequence 
      AND dn.pol_end_no = pn.pol_end_no 
      AND dn.pol_note_no = pn.pol_note_no 
      AND pn.pol_resv = '00'
    JOIN policy_endorsement pe ON pe.pol_office = dn.pol_office 
      AND pe.pol_subclass = dn.pol_subclass 
      AND pe.pol_resv = '00' 
      AND pe.pol_year = dn.pol_year 
      AND pe.pol_month = dn.pol_month 
      AND pe.pol_sequence = dn.pol_sequence 
      AND pe.pol_end_no = dn.pol_end_no
    JOIN policy_main pm ON pm.pol_office = dn.pol_office 
      AND pm.pol_subclass = dn.pol_subclass 
      AND pm.pol_resv = '00' 
      AND pm.pol_year = dn.pol_year 
      AND pm.pol_month = dn.pol_month 
      AND pm.pol_sequence = dn.pol_sequence 
      AND pm.pol_end_no = dn.pol_end_no
    JOIN policy_insured_detail pid ON pid.pol_office = dn.pol_office 
      AND pid.pol_subclass = dn.pol_subclass 
      AND pid.pol_resv = '00' 
      AND pid.pol_year = dn.pol_year 
      AND pid.pol_month = dn.pol_month 
      AND pid.pol_sequence = dn.pol_sequence 
      AND pid.pol_end_no = dn.pol_end_no
    -- policy_risk_profile has no unique key and carries fully duplicated rows
    -- even at a fixed (policy, item_no, no_of_years), so a plain join fans
    -- out. LIMIT 1 is safe: the duplicates are identical, and only tsi is read.
    LEFT JOIN LATERAL (
      SELECT p.tsi
      FROM policy_risk_profile p
      WHERE p.pol_office = dn.pol_office
        AND p.pol_subclass = dn.pol_subclass
        AND p.pol_resv = '00'
        AND p.pol_year = dn.pol_year
        AND p.pol_month = dn.pol_month
        AND p.pol_sequence = dn.pol_sequence
        AND p.pol_end_no = dn.pol_end_no
        AND p.item_no = '001'
        AND p.no_of_years = '1'
      LIMIT 1
    ) prp ON TRUE
    LEFT JOIN policy_motor_info pmi ON pmi.pol_office = dn.pol_office 
      AND pmi.pol_subclass = dn.pol_subclass 
      AND pmi.pol_resv = '00' 
      AND pmi.pol_year = dn.pol_year 
      AND pmi.pol_month = dn.pol_month 
      AND pmi.pol_sequence = dn.pol_sequence 
      AND pmi.pol_end_no = dn.pol_end_no 
      AND pmi.item_no = '001'
    JOIN master_rbc_lob rl ON rl.subclass_code = dn.pol_subclass
    JOIN master_branch mb ON mb.office_code = dn.pol_office
    JOIN master_cm cm ON cm.cm_code = pm.distribution_code
    LEFT JOIN LATERAL (
      SELECT e.the_rate
      FROM exch_rate e
      WHERE e.cur_code = dn.currency
        AND e.as_at >= TO_DATE(pe.acct_year || pe.acct_month || '01', 'YYYYMMDD')
        AND e.as_at < TO_DATE(pe.acct_year || pe.acct_month || '01', 'YYYYMMDD') + INTERVAL '1 month'
      ORDER BY e.as_at DESC
      LIMIT 1
    ) exc ON TRUE
  `,
    {
      indexes: [
        {
          name: "idx_soa_pipeline_staging_dist",
          columns: "distribution_code, branch",
        },
      ],
      // Every read of this table filters by customer, so lay rows out in that
      // order — each customer's rows land contiguous instead of scattered.
      orderBy: "distribution_code, branch",
    }
  );

  return {
    rowsAffected: result.rowCount ?? 0,
    durationMs: Date.now() - startTime,
  };
}
