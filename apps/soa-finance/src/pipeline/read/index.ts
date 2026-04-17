import { streamQueryFromOracle } from "./oracle-stream-reader";

const SOA_QUERY = `
SELECT
  mb.description branch,
  dn.pol_subclass || '-' || dn.pol_office || '-' || dn.pol_month || '-' || dn.pol_year || '-' || dn.pol_seq policy_no,
  dn.pol_end_no,
  pm.alt_polno contract_no,
  pmi.plat_no_1 || pmi.plat_no_2 || pmi.plat_no_3 plat_no,
  pm.co_in_fac_ref_no, pm.fire_conjunction_pol,
  rl.lob_desc lob,
  pm.source_of_business sob,
  CASE WHEN pm.distribution_type = 'DI' THEN dn.dc_account_full_name ELSE '' END dc_account_full_name,
  pm.insured_name,
  pm.distribution_name,
  pm.distribution_name2,
  pid.qq_name,
  pe.end_eff_date,
  pe.end_exp_date,
  pm.post_date,
  TRUNC(:p_as_at_date) - CASE WHEN pe.pol_end_no = '000' THEN TRUNC(pe.end_eff_date) ELSE TRUNC(pe.end_post_date) END aging,
  dn.currency curr,
  NVL(exc.the_rate, 1) exch_rate,
  pe.end_reason,
  cm.acting_code,
  prp.tsi,
  SUM(CASE WHEN pnd.pol_note_trn_code IN ('DPRM','CPRM','RPRM') THEN pnd.pol_note_trn_amount ELSE 0 END) GP,
  SUM(CASE WHEN pnd.pol_note_trn_code IN ('DDSC','CDIS','CDSC','DDS1') THEN pnd.pol_note_trn_amount ELSE 0 END) DISC,
  SUM(CASE WHEN pnd.pol_note_trn_code IN ('DCOM','CCOM','MCOM','RCOM','DBKG') THEN pnd.pol_note_trn_amount ELSE 0 END) COMM,
  SUM(CASE WHEN pnd.pol_note_trn_code IN ('DVAT') THEN pnd.pol_note_trn_amount ELSE 0 END) PPN,
  SUM(CASE WHEN pnd.pol_note_trn_code IN ('DW21') THEN pnd.pol_note_trn_amount ELSE 0 END) PPH21,
  SUM(CASE WHEN pnd.pol_note_trn_code IN ('DWTX') THEN pnd.pol_note_trn_amount ELSE 0 END) PPH23,
  SUM(CASE WHEN pnd.pol_note_trn_code IN ('COST') THEN pnd.pol_note_trn_amount ELSE 0 END) COST,
  SUM(CASE WHEN pnd.pol_note_trn_code IN ('STMP') THEN pnd.pol_note_trn_amount ELSE 0 END) STMP,
  SUM(pnd.pol_note_trn_amount) NETT_PREMIUM,
  pn.pol_inst_no || '/' || pn.pol_total_inst inst_no,
  pn.due_date,
  dn.dc_office || '-' || dn.dc_month || '-' || dn.dc_mode || '-' || dn.dc_year || '-' || dn.dc_seq DC_NOTE,
  dn.orig_amount,
  pm.distribution_code
FROM DCNOTE dn
LEFT JOIN (
  SELECT FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ,
    SUM(FS.FN_ORIG_AMT) AMT
  FROM FINANCIAL_SETTLE FS
  WHERE POST_DATE < :p_as_at_date + 1
  GROUP BY FS.DC_OFFICE, FS.DC_YEAR, FS.DC_MONTH, FS.DC_MODE, FS.DC_SEQ
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
  AND TO_CHAR(exc.as_at, 'yyyyMM') = pe.acct_year || pe.acct_month
WHERE
  dn.dc_mode IN ('01','02','03','04','05')
  AND dn.pol_office IS NOT NULL
  AND pm.post_date < SYSDATE + 1
  AND (ABS(dn.orig_amount) - ABS(NVL(fst.amt, 0))) > 1
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

export function streamSoaData(asAtDate: Date) {
  return streamQueryFromOracle(SOA_QUERY, {
    p_as_at_date: asAtDate,
  });
}
