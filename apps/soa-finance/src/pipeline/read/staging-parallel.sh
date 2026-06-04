#!/bin/bash
# Parallel office processing for SOA staging
# Processes multiple offices simultaneously to reduce total time

PSQL="/Users/dimaz/workspace/office/projects/restate-services/.claude/skills/querying-postgres/scripts/psql.sh"
PARALLEL=${1:-4}  # Default 4 parallel jobs

echo "=== SOA Staging Parallel Processor ==="
echo "Parallel jobs: $PARALLEL"
echo ""

# Create staging table if not exists
$PSQL -c "DROP TABLE IF EXISTS soa_pipeline_staging_build;"
$PSQL -c "CREATE TABLE soa_pipeline_staging_build (LIKE soa_pipeline_staging INCLUDING ALL);"

# Get list of offices
OFFICES=$($PSQL -t -A -c "SELECT DISTINCT pol_office FROM dcnote WHERE dc_mode IN ('01','02','03','04','05') AND pol_office IS NOT NULL ORDER BY pol_office;")

TOTAL_OFFICES=$(echo "$OFFICES" | wc -w | tr -d ' ')
echo "Processing $TOTAL_OFFICES offices with $PARALLEL parallel jobs"
echo ""

# Function to process one office
process_office() {
  local OFFICE=$1
  local START_TIME=$(date +%s)
  
  $PSQL -c "
    INSERT INTO soa_pipeline_staging_build
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
      CURRENT_DATE - CASE WHEN pe.pol_end_no = '000' THEN pe.end_eff_date::date ELSE pe.end_post_date::date END,
      dn.currency,
      COALESCE(exc.the_rate, 1),
      pe.end_reason, cm.acting_code, prp.tsi,
      pnd.premium,
      pnd.discount,
      pnd.commission,
      pnd.vat,
      pnd.w21,
      pnd.wtx,
      pnd.cost,
      pnd.stamp,
      pnd.total,
      pn.pol_inst_no || '/' || pn.pol_total_inst, pn.due_date,
      dn.dc_office || '-' || dn.dc_month || '-' || dn.dc_mode || '-' || dn.dc_year || '-' || dn.dc_seq,
      dn.orig_amount, pm.distribution_code,
      '2025-06'
    FROM DCNOTE dn
    LEFT JOIN soa_fin_settle_agg fst ON 
      dn.dc_office = fst.dc_office 
      AND dn.dc_year = fst.dc_year
      AND dn.dc_month = fst.dc_month 
      AND dn.dc_mode = fst.dc_mode 
      AND dn.dc_seq = fst.dc_seq
    JOIN pnd_agg pnd ON
      dn.pol_office = pnd.pol_office AND dn.pol_subclass = pnd.pol_subclass
      AND dn.pol_year = pnd.pol_year AND dn.pol_month = pnd.pol_month
      AND dn.pol_seq = pnd.pol_sequence AND dn.pol_end_no = pnd.pol_end_no
      AND dn.pol_notes_no = pnd.pol_note_no
    JOIN POLICY_NOTE pn ON
      dn.pol_office = pn.pol_office AND dn.pol_subclass = pn.pol_subclass
      AND dn.pol_year = pn.pol_year AND dn.pol_month = pn.pol_month
      AND dn.pol_seq = pn.pol_sequence AND dn.pol_end_no = pn.pol_end_no
      AND dn.pol_notes_no = pn.pol_note_no
      AND pn.pol_resv = '00'
    JOIN POLICY_ENDORSEMENT pe ON
      pe.pol_office = pnd.pol_office AND pe.pol_subclass = pnd.pol_subclass
      AND pe.pol_resv = '00'
      AND pe.pol_year = pnd.pol_year AND pe.pol_month = pnd.pol_month
      AND pe.pol_sequence = pnd.pol_sequence AND pe.pol_end_no = pnd.pol_end_no
    JOIN POLICY_MAIN pm ON
      pm.pol_office = pe.pol_office AND pm.pol_subclass = pe.pol_subclass
      AND pm.pol_resv = '00'
      AND pm.pol_year = pe.pol_year AND pm.pol_month = pe.pol_month
      AND pm.pol_sequence = pe.pol_sequence AND pm.pol_end_no = pe.pol_end_no
    JOIN POLICY_INSURED_DETAIL pid ON
      pm.pol_office = pid.pol_office AND pm.pol_subclass = pid.pol_subclass
      AND pid.pol_resv = '00'
      AND pm.pol_year = pid.pol_year AND pm.pol_month = pid.pol_month
      AND pm.pol_sequence = pid.pol_sequence AND pm.pol_end_no = pid.pol_end_no
    LEFT JOIN POLICY_RISK_PROFILE prp ON
      pm.pol_office = prp.pol_office AND pm.pol_subclass = prp.pol_subclass
      AND prp.pol_resv = '00'
      AND pm.pol_year = prp.pol_year AND pm.pol_month = prp.pol_month
      AND pm.pol_sequence = prp.pol_sequence AND pm.pol_end_no = prp.pol_end_no
      AND prp.item_no = '001' AND prp.no_of_years = '1'
    LEFT JOIN POLICY_MOTOR_INFO pmi ON
      pm.pol_office = pmi.pol_office AND pm.pol_subclass = pmi.pol_subclass
      AND pmi.pol_resv = '00'
      AND pm.pol_year = pmi.pol_year AND pm.pol_month = pmi.pol_month
      AND pm.pol_sequence = pmi.pol_sequence AND pm.pol_end_no = pmi.pol_end_no
      AND pmi.item_no = '001'
    JOIN MASTER_RBC_LOB rl ON pm.pol_subclass = rl.subclass_code
    JOIN MASTER_BRANCH mb ON mb.office_code = pm.pol_office
    JOIN MASTER_CM cm ON pm.distribution_code = cm.cm_code
    LEFT JOIN EXCH_RATE exc ON dn.currency = exc.cur_code
      AND exc.as_at >= TO_DATE(pe.acct_year || pe.acct_month || '01', 'YYYYMMDD')
      AND exc.as_at <  TO_DATE(pe.acct_year || pe.acct_month || '01', 'YYYYMMDD') + INTERVAL '1 month'
    WHERE dn.dc_mode IN ('01','02','03','04','05')
      AND dn.pol_office IS NOT NULL
      AND pm.post_date < CURRENT_TIMESTAMP + INTERVAL '1 day'
      AND (ABS(dn.orig_amount) - ABS(COALESCE(fst.amt, 0))) > 1
      AND dn.pol_office = '$OFFICE';
  " 2>&1
  
  local END_TIME=$(date +%s)
  local DURATION=$((END_TIME - START_TIME))
  echo "✓ Office $OFFICE completed in ${DURATION}s"
}

export -f process_office
export PSQL

# Process offices in parallel
echo "$OFFICES" | tr ' ' '\n' | xargs -P $PARALLEL -I {} bash -c 'process_office "$@"' _ {}

# Create index and analyze
echo ""
echo "Creating index..."
$PSQL -c "CREATE INDEX ON soa_pipeline_staging_build (distribution_code, branch);"
$PSQL -c "ANALYZE soa_pipeline_staging_build;"

# Swap tables
echo "Swapping tables..."
$PSQL -c "
  BEGIN;
  DROP TABLE IF EXISTS soa_pipeline_staging_old;
  ALTER TABLE IF EXISTS soa_pipeline_staging RENAME TO soa_pipeline_staging_old;
  ALTER TABLE soa_pipeline_staging_build RENAME TO soa_pipeline_staging;
  COMMIT;
  DROP TABLE IF EXISTS soa_pipeline_staging_old;
"

# Final count
TOTAL_ROWS=$($PSQL -t -A -c "SELECT COUNT(*) FROM soa_pipeline_staging;")
echo ""
echo "=== Complete ==="
echo "Total rows: $TOTAL_ROWS"
