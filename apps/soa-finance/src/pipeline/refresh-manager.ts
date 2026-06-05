import {
  type ObjectContext,
  object,
  TerminalError,
} from "@restatedev/restate-sdk";
import { getPostgresClient } from "../infrastructure/database/postgres.js";

// Refresh state tracked in Virtual Object
export interface RefreshState {
  lastRefresh: string; // ISO timestamp
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

// Shared refresh logic (not a handler - just a function)
async function executeRefresh(
  ctx: ObjectContext,
  state: RefreshState,
  forceFull: boolean
): Promise<{
  status: string;
  durationMs?: number;
  steps?: Record<string, unknown>;
}> {
  // Prevent concurrent refreshes
  if (state.status === "running") {
    ctx.console.log("Refresh already in progress, skipping");
    return { status: "already_running" };
  }

  // Update state to running
  state.status = "running";
  state.steps = {};
  ctx.set("state", state);

  try {
    const lastRefresh = forceFull ? new Date(0) : new Date(state.lastRefresh);
    const now = new Date();

    // Step 1: Refresh soa_fin_settle_agg
    state.steps.fin_settle_agg = {
      status: "running",
      rowsAffected: 0,
      durationMs: 0,
    };

    const step1Result = await ctx.run("refresh-fin-settle-agg", () =>
      refreshFinSettleAgg(lastRefresh)
    );
    state.steps.fin_settle_agg = {
      status: "completed",
      rowsAffected: step1Result.rowsAffected,
      durationMs: step1Result.durationMs,
    };
    ctx.set("state", state);

    // Step 2: Refresh soa_pnd_agg
    state.steps.pnd_agg = { status: "running", rowsAffected: 0, durationMs: 0 };

    const step2Result = await ctx.run("refresh-pnd-agg", () =>
      refreshPndAgg(lastRefresh)
    );
    state.steps.pnd_agg = {
      status: "completed",
      rowsAffected: step2Result.rowsAffected,
      durationMs: step2Result.durationMs,
    };
    ctx.set("state", state);

    // Step 3: Refresh soa_staging_unpaid
    state.steps.staging_unpaid = {
      status: "running",
      rowsAffected: 0,
      durationMs: 0,
    };

    const step3Result = await ctx.run("refresh-staging-unpaid", () =>
      refreshStagingUnpaid(lastRefresh)
    );
    state.steps.staging_unpaid = {
      status: "completed",
      rowsAffected: step3Result.rowsAffected,
      durationMs: step3Result.durationMs,
    };
    ctx.set("state", state);

    // Step 4: Refresh soa_staging_unpaid_pnd
    state.steps.staging_unpaid_pnd = {
      status: "running",
      rowsAffected: 0,
      durationMs: 0,
    };

    const step4Result = await ctx.run("refresh-staging-unpaid-pnd", () =>
      refreshStagingUnpaidPnd(lastRefresh)
    );
    state.steps.staging_unpaid_pnd = {
      status: "completed",
      rowsAffected: step4Result.rowsAffected,
      durationMs: step4Result.durationMs,
    };
    ctx.set("state", state);

    // Step 5: Refresh soa_pipeline_staging
    state.steps.pipeline_staging = {
      status: "running",
      rowsAffected: 0,
      durationMs: 0,
    };

    const step5Result = await ctx.run("refresh-pipeline-staging", () =>
      refreshPipelineStaging(lastRefresh)
    );
    state.steps.pipeline_staging = {
      status: "completed",
      rowsAffected: step5Result.rowsAffected,
      durationMs: step5Result.durationMs,
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
    state.status = "failed";
    ctx.set("state", state);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    ctx.console.error(`Refresh failed: ${errorMessage}`);

    throw new TerminalError(`Refresh failed: ${errorMessage}`);
  }
}

export const SoaRefreshManager = object({
  name: "SoaRefreshManager",
  handlers: {
    // Start incremental refresh
    refresh: async (ctx: ObjectContext) => {
      const state = (await ctx.get<RefreshState>("state")) ?? {
        lastRefresh: new Date(0).toISOString(),
        status: "idle",
        steps: {},
      };

      return executeRefresh(ctx, state, false);
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

    // Force full refresh (ignores lastRefresh timestamp)
    forceFullRefresh: async (ctx: ObjectContext) => {
      const state = (await ctx.get<RefreshState>("state")) ?? {
        lastRefresh: new Date(0).toISOString(),
        status: "idle",
        steps: {},
      };

      // Force full refresh by setting lastRefresh to epoch
      state.lastRefresh = new Date(0).toISOString();
      ctx.set("state", state);

      return executeRefresh(ctx, state, true);
    },
  },
});

// Helper functions for each refresh step
async function refreshFinSettleAgg(lastRefresh: Date): Promise<RefreshResult> {
  const startTime = Date.now();
  const client = getPostgresClient();

  const result = await client.executeQuery(
    `
    INSERT INTO soa_fin_settle_agg
    SELECT dc_office, dc_year, dc_month, dc_mode, dc_seq, SUM(fn_orig_amt) AS amt
    FROM financial_settle
    WHERE mod_date > $1
      AND dc_office IS NOT NULL
    GROUP BY dc_office, dc_year, dc_month, dc_mode, dc_seq
    ON CONFLICT (dc_office, dc_year, dc_month, dc_mode, dc_seq)
    DO UPDATE SET amt = EXCLUDED.amt
  `,
    [lastRefresh]
  );

  return {
    rowsAffected: result.rowCount ?? 0,
    durationMs: Date.now() - startTime,
  };
}

async function refreshPndAgg(lastRefresh: Date): Promise<RefreshResult> {
  const startTime = Date.now();
  const client = getPostgresClient();

  const result = await client.executeQuery(
    `
    INSERT INTO soa_pnd_agg
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
    WHERE mod_date > $1
      AND pol_note_trn_code IN ('DPRM','CPRM','RPRM','DDSC','CDIS','CDSC','DDS1','DCOM','CCOM','MCOM','RCOM','DBKG','DVAT','DW21','DWTX','COST','STMP')
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
      last_updated = NOW()
  `,
    [lastRefresh]
  );

  return {
    rowsAffected: result.rowCount ?? 0,
    durationMs: Date.now() - startTime,
  };
}

async function refreshStagingUnpaid(lastRefresh: Date): Promise<RefreshResult> {
  const startTime = Date.now();
  const client = getPostgresClient();

  const result = await client.executeQuery(
    `
    INSERT INTO soa_staging_unpaid
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
      AND dn.upd_date > $1
    ON CONFLICT (dc_office, dc_year, dc_month, dc_mode, dc_seq)
    DO UPDATE SET
      pol_office = EXCLUDED.pol_office,
      pol_subclass = EXCLUDED.pol_subclass,
      pol_year = EXCLUDED.pol_year,
      pol_month = EXCLUDED.pol_month,
      pol_sequence = EXCLUDED.pol_sequence,
      pol_end_no = EXCLUDED.pol_end_no,
      pol_note_no = EXCLUDED.pol_note_no,
      orig_amount = EXCLUDED.orig_amount,
      currency = EXCLUDED.currency,
      dc_account_full_name = EXCLUDED.dc_account_full_name,
      dc_post_date = EXCLUDED.dc_post_date,
      settled_amount = EXCLUDED.settled_amount
  `,
    [lastRefresh]
  );

  return {
    rowsAffected: result.rowCount ?? 0,
    durationMs: Date.now() - startTime,
  };
}

async function refreshStagingUnpaidPnd(
  lastRefresh: Date
): Promise<RefreshResult> {
  const startTime = Date.now();
  const client = getPostgresClient();

  const result = await client.executeQuery(
    `
    INSERT INTO soa_staging_unpaid_pnd
    SELECT 
      dn.dc_office, dn.dc_year, dn.dc_month, dn.dc_mode, dn.dc_seq,
      dn.pol_office, dn.pol_subclass, dn.pol_year, dn.pol_month, dn.pol_sequence, dn.pol_end_no, dn.pol_note_no,
      dn.orig_amount, dn.currency, dn.dc_account_full_name, dn.dc_post_date, dn.settled_amount,
      pnd.premium, pnd.discount, pnd.commission, pnd.vat, pnd.w21, pnd.wtx, pnd.cost, pnd.stamp, pnd.total
    FROM soa_staging_unpaid dn
    JOIN soa_pnd_agg pnd ON dn.pol_office = pnd.pol_office 
      AND dn.pol_subclass = pnd.pol_subclass 
      AND dn.pol_year = pnd.pol_year 
      AND dn.pol_month = pnd.pol_month 
      AND dn.pol_sequence = pnd.pol_sequence 
      AND dn.pol_end_no = pnd.pol_end_no 
      AND dn.pol_note_no = pnd.pol_note_no
    WHERE dn.dc_post_date > $1
    ON CONFLICT (dc_office, dc_year, dc_month, dc_mode, dc_seq)
    DO UPDATE SET
      pol_office = EXCLUDED.pol_office,
      pol_subclass = EXCLUDED.pol_subclass,
      pol_year = EXCLUDED.pol_year,
      pol_month = EXCLUDED.pol_month,
      pol_sequence = EXCLUDED.pol_sequence,
      pol_end_no = EXCLUDED.pol_end_no,
      pol_note_no = EXCLUDED.pol_note_no,
      orig_amount = EXCLUDED.orig_amount,
      currency = EXCLUDED.currency,
      dc_account_full_name = EXCLUDED.dc_account_full_name,
      dc_post_date = EXCLUDED.dc_post_date,
      settled_amount = EXCLUDED.settled_amount,
      premium = EXCLUDED.premium,
      discount = EXCLUDED.discount,
      commission = EXCLUDED.commission,
      vat = EXCLUDED.vat,
      w21 = EXCLUDED.w21,
      wtx = EXCLUDED.wtx,
      cost = EXCLUDED.cost,
      stamp = EXCLUDED.stamp,
      total = EXCLUDED.total
  `,
    [lastRefresh]
  );

  return {
    rowsAffected: result.rowCount ?? 0,
    durationMs: Date.now() - startTime,
  };
}

async function refreshPipelineStaging(
  lastRefresh: Date
): Promise<RefreshResult> {
  const startTime = Date.now();
  const client = getPostgresClient();

  // Delete rows for changed dc_notes
  await client.executeQuery(
    `
    DELETE FROM soa_pipeline_staging
    WHERE dc_note IN (
      SELECT DISTINCT dn.dc_office || '-' || dn.dc_month || '-' || dn.dc_mode || '-' || dn.dc_year || '-' || dn.dc_seq
      FROM soa_staging_unpaid_pnd dn
      WHERE dn.dc_post_date > $1
    )
  `,
    [lastRefresh]
  );

  // Insert new/updated rows
  const result = await client.executeQuery(
    `
    INSERT INTO soa_pipeline_staging
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
      dn.premium as gp,
      dn.discount as disc,
      dn.commission as comm,
      dn.vat as ppn,
      dn.w21 as pph21,
      dn.wtx as pph23,
      dn.cost,
      dn.stamp as stmp,
      dn.total as nett_premium,
      pn.pol_inst_no || '/' || pn.pol_total_inst as inst_no,
      pn.due_date,
      dn.dc_office || '-' || dn.dc_month || '-' || dn.dc_mode || '-' || dn.dc_year || '-' || dn.dc_seq as dc_note,
      dn.orig_amount,
      pm.distribution_code
    FROM soa_staging_unpaid_pnd dn
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
    LEFT JOIN policy_risk_profile prp ON prp.pol_office = dn.pol_office 
      AND prp.pol_subclass = dn.pol_subclass 
      AND prp.pol_resv = '00' 
      AND prp.pol_year = dn.pol_year 
      AND prp.pol_month = dn.pol_month 
      AND prp.pol_sequence = dn.pol_sequence 
      AND prp.pol_end_no = dn.pol_end_no 
      AND prp.item_no = '001' 
      AND prp.no_of_years = '1'
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
    LEFT JOIN exch_rate exc ON exc.cur_code = dn.currency 
      AND exc.as_at >= TO_DATE(pe.acct_year || pe.acct_month || '01', 'YYYYMMDD')
      AND exc.as_at < TO_DATE(pe.acct_year || pe.acct_month || '01', 'YYYYMMDD') + INTERVAL '1 month'
    WHERE dn.dc_post_date > $1
  `,
    [lastRefresh]
  );

  return {
    rowsAffected: result.rowCount ?? 0,
    durationMs: Date.now() - startTime,
  };
}
