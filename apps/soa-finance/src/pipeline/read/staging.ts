import { getPostgresClient } from "../../infrastructure/database/postgres.js";
import { formatTimePeriod } from "../../utils/formatter/date.formatter.js";
import logger from "../../utils/logger.js";

const BUILD_TABLE = "soa_pipeline_staging_build";
const ACTIVE_TABLE = "soa_pipeline_staging";

const SOA_QUERY = `
INSERT INTO ${BUILD_TABLE}
SELECT
  mb.description,
  dn.pol_subclass || '-' || dn.pol_office || '-' || dn.pol_month || '-' || dn.pol_year || '-' || dn.pol_seq,
  dn.pol_end_no,
  pm.alt_polno,
  pmi.plat_no_1 || pmi.plat_no_2 || pmi.plat_no_3,
  pm.co_in_fac_ref_no, pm.fire_conjunction_pol,
  rl.lob_desc,
  pm.source_of_business,
  CASE WHEN pm.distribution_type = 'DI' THEN dn.dc_account_full_name ELSE '' END,
  pm.insured_name, pm.distribution_name, pm.distribution_name2,
  pid.qq_name,
  pe.end_eff_date, pe.end_exp_date, pm.post_date,
  $1::date - CASE WHEN pe.pol_end_no = '000' THEN pe.end_eff_date::date ELSE pe.end_post_date::date END,
  dn.currency,
  COALESCE(exc.the_rate, 1),
  pe.end_reason, cm.acting_code, prp.tsi,
  COALESCE(SUM(pnd.pol_note_trn_amount) FILTER (WHERE pnd.pol_note_trn_code IN ('DPRM','CPRM','RPRM')), 0),
  COALESCE(SUM(pnd.pol_note_trn_amount) FILTER (WHERE pnd.pol_note_trn_code IN ('DDSC','CDIS','CDSC','DDS1')), 0),
  COALESCE(SUM(pnd.pol_note_trn_amount) FILTER (WHERE pnd.pol_note_trn_code IN ('DCOM','CCOM','MCOM','RCOM','DBKG')), 0),
  COALESCE(SUM(pnd.pol_note_trn_amount) FILTER (WHERE pnd.pol_note_trn_code IN ('DVAT')), 0),
  COALESCE(SUM(pnd.pol_note_trn_amount) FILTER (WHERE pnd.pol_note_trn_code IN ('DW21')), 0),
  COALESCE(SUM(pnd.pol_note_trn_amount) FILTER (WHERE pnd.pol_note_trn_code IN ('DWTX')), 0),
  COALESCE(SUM(pnd.pol_note_trn_amount) FILTER (WHERE pnd.pol_note_trn_code IN ('COST')), 0),
  COALESCE(SUM(pnd.pol_note_trn_amount) FILTER (WHERE pnd.pol_note_trn_code IN ('STMP')), 0),
  SUM(pnd.pol_note_trn_amount),
  pn.pol_inst_no || '/' || pn.pol_total_inst, pn.due_date,
  dn.dc_office || '-' || dn.dc_month || '-' || dn.dc_mode || '-' || dn.dc_year || '-' || dn.dc_seq,
  dn.orig_amount, pm.distribution_code,
  $2
FROM DCNOTE dn
LEFT JOIN (
  SELECT dc_office, dc_year, dc_month, dc_mode, dc_seq,
    SUM(fn_orig_amt) AS amt
  FROM financial_settle
  WHERE post_date < $1::date + INTERVAL '1 day'
  GROUP BY dc_office, dc_year, dc_month, dc_mode, dc_seq
) fst ON dn.dc_office = fst.dc_office AND dn.dc_year = fst.dc_year
  AND dn.dc_month = fst.dc_month AND dn.dc_mode = fst.dc_mode AND dn.dc_seq = fst.dc_seq
JOIN POLICY_NOTE_DETAIL pnd ON
  dn.pol_office = pnd.pol_office AND dn.pol_subclass = pnd.pol_subclass
  AND dn.pol_resv = pnd.pol_resv AND dn.pol_year = pnd.pol_year
  AND dn.pol_month = pnd.pol_month AND dn.pol_seq = pnd.pol_sequence
  AND dn.pol_end_no = pnd.pol_end_no AND dn.pol_notes_no = pnd.pol_note_no
JOIN POLICY_NOTE pn ON
  dn.pol_office = pn.pol_office AND dn.pol_subclass = pn.pol_subclass
  AND dn.pol_resv = pn.pol_resv AND dn.pol_year = pn.pol_year
  AND dn.pol_month = pn.pol_month AND dn.pol_seq = pn.pol_sequence
  AND dn.pol_end_no = pn.pol_end_no AND dn.pol_notes_no = pn.pol_note_no
JOIN POLICY_ENDORSEMENT pe ON
  pe.pol_office = pnd.pol_office AND pe.pol_subclass = pnd.pol_subclass
  AND pe.pol_resv = pnd.pol_resv AND pe.pol_year = pnd.pol_year
  AND pe.pol_month = pnd.pol_month AND pe.pol_sequence = pnd.pol_sequence
  AND pe.pol_end_no = pnd.pol_end_no
JOIN POLICY_MAIN pm ON
  pm.pol_office = pe.pol_office AND pm.pol_subclass = pe.pol_subclass
  AND pm.pol_resv = pe.pol_resv AND pm.pol_year = pe.pol_year
  AND pm.pol_month = pe.pol_month AND pm.pol_sequence = pe.pol_sequence
  AND pm.pol_end_no = pe.pol_end_no
JOIN POLICY_INSURED_DETAIL pid ON
  pm.pol_office = pid.pol_office AND pm.pol_subclass = pid.pol_subclass
  AND pm.pol_resv = pid.pol_resv AND pm.pol_year = pid.pol_year
  AND pm.pol_month = pid.pol_month AND pm.pol_sequence = pid.pol_sequence
  AND pm.pol_end_no = pid.pol_end_no
LEFT JOIN POLICY_RISK_PROFILE prp ON
  pm.pol_office = prp.pol_office AND pm.pol_subclass = prp.pol_subclass
  AND pm.pol_resv = prp.pol_resv AND pm.pol_year = prp.pol_year
  AND pm.pol_month = prp.pol_month AND pm.pol_sequence = prp.pol_sequence
  AND pm.pol_end_no = prp.pol_end_no
  AND prp.item_no = '001' AND prp.no_of_years = '1'
LEFT JOIN POLICY_MOTOR_INFO pmi ON
  pm.pol_office = pmi.pol_office AND pm.pol_subclass = pmi.pol_subclass
  AND pm.pol_resv = pmi.pol_resv AND pm.pol_year = pmi.pol_year
  AND pm.pol_month = pmi.pol_month AND pm.pol_sequence = pmi.pol_sequence
  AND pm.pol_end_no = pmi.pol_end_no AND pmi.item_no = '001'
JOIN MASTER_RBC_LOB rl ON pm.pol_subclass = rl.subclass_code
JOIN MASTER_BRANCH mb ON mb.office_code = pm.pol_office
JOIN MASTER_CM cm ON pm.distribution_code = cm.cm_code
LEFT JOIN EXCH_RATE exc ON dn.currency = exc.cur_code
  AND exc.as_at >= TO_DATE(pe.acct_year || pe.acct_month || '01', 'YYYYMMDD')
  AND exc.as_at <  TO_DATE(pe.acct_year || pe.acct_month || '01', 'YYYYMMDD') + INTERVAL '1 month'
WHERE
  dn.dc_mode IN ('01','02','03','04','05')
  AND dn.pol_office IS NOT NULL
  AND pm.post_date < CURRENT_TIMESTAMP + INTERVAL '1 day'
  AND (ABS(dn.orig_amount) - ABS(COALESCE(fst.amt, 0))) > 1
  AND pnd.pol_note_trn_code IN (
    'DPRM','CPRM','RPRM','DDSC','CDIS','CDSC','DDS1',
    'DCOM','CCOM','MCOM','RCOM','DBKG',
    'DVAT','DW21','DWTX','COST','STMP'
  )
GROUP BY
  mb.description,
  dn.pol_subclass, dn.pol_office, dn.pol_month, dn.pol_year, dn.pol_seq,
  dn.pol_end_no,
  pm.alt_polno,
  pmi.plat_no_1, pmi.plat_no_2, pmi.plat_no_3,
  pm.co_in_fac_ref_no, pm.fire_conjunction_pol,
  rl.lob_desc,
  pm.source_of_business,
  pm.distribution_type, dn.dc_account_full_name,
  pm.insured_name,
  pm.distribution_name, pm.distribution_name2,
  pid.qq_name,
  pe.end_eff_date, pe.end_exp_date,
  pm.post_date,
  pe.pol_end_no, pe.end_eff_date, pe.end_post_date,
  dn.currency,
  exc.the_rate,
  pe.end_reason,
  cm.acting_code,
  prp.tsi,
  pn.pol_inst_no, pn.pol_total_inst, pn.due_date,
  dn.dc_office, dn.dc_year, dn.dc_month, dn.dc_mode, dn.dc_seq,
  dn.orig_amount,
  pm.distribution_code
`;

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
    await conn.query(SOA_QUERY, [asAtDate, period]);

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
  } catch (error) {
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
