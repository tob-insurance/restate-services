import { SENTINEL_ALL } from "../../constants/constants.js";
import { executeQuery } from "../../infrastructure/database/postgres.js";
import type { StatementOfAccountModel } from "../../types/soa.type.js";

interface StagingRow {
  acting_code: string;
  aging: number;
  branch: string;
  co_in_fac_ref_no: string;
  comm: number;
  contract_no: string;
  cost: number;
  curr: string;
  dc_account_full_name: string;
  dc_note: string;
  disc: number;
  distribution_code: string;
  distribution_name: string;
  distribution_name2: string;
  due_date: string;
  end_eff_date: string;
  end_exp_date: string;
  end_reason: string;
  exch_rate: number;
  fire_conjunction_pol: string;
  gp: number;
  inst_no: string;
  insured_name: string;
  lob: string;
  nett_premium: number;
  orig_amount: number;
  plat_no: string;
  pol_end_no: string;
  policy_no: string;
  post_date: string;
  pph21: number;
  pph23: number;
  ppn: number;
  qq_name: string;
  sob: string;
  stmp: number;
  tsi: number;
}

interface StagingRowMinimal {
  branch: string;
  dc_note: string;
  nett_premium: number;
}

export interface StagingMinimalItem {
  branch: string;
  debitAndCreditNoteNo: string;
  netPremium: number;
}

function mapRow(row: StagingRow): StatementOfAccountModel {
  const netPremium = Number(row.nett_premium) || 0;
  const exchangeRate = Number(row.exch_rate) || 1;
  const s = (v: string | null | undefined) => v ?? "";
  const n = (v: number | null | undefined) => Number(v) || 0;

  return {
    debitAndCreditNoteNo: s(row.dc_note),
    branch: s(row.branch),
    policyNo: s(row.policy_no),
    policyEndNo: s(row.pol_end_no),
    contractNo: s(row.contract_no),
    plateNo: s(row.plat_no),
    coInFacRefNo: s(row.co_in_fac_ref_no),
    fireConjunctionPolicy: s(row.fire_conjunction_pol),
    lob: s(row.lob),
    sourceOfBusiness: s(row.sob),
    accountName: s(row.dc_account_full_name),
    insuredName: s(row.insured_name),
    distributionName: s(row.distribution_name),
    distributionNameSecond: s(row.distribution_name2),
    qualitateQuaName: s(row.qq_name),
    endEffDate: s(row.end_eff_date),
    endExpDate: s(row.end_exp_date),
    postDate: s(row.post_date),
    dueDate: s(row.due_date),
    aging: n(row.aging),
    currency: s(row.curr),
    exchangeRate,
    endReason: s(row.end_reason),
    actingCode: s(row.acting_code),
    totalSumInsured: n(row.tsi),
    grossPremium: n(row.gp),
    discount: n(row.disc),
    commission: n(row.comm),
    ppn: n(row.ppn),
    pph21: n(row.pph21),
    pph23: n(row.pph23),
    cost: n(row.cost),
    stmp: n(row.stmp),
    netPremium,
    netPremiumIdr: netPremium * exchangeRate,
    installment: s(row.inst_no),
    origAmount: n(row.orig_amount),
    distributionCode: s(row.distribution_code),
  };
}

function mapRowMinimal(row: StagingRowMinimal): StagingMinimalItem {
  return {
    branch: row.branch ?? "",
    debitAndCreditNoteNo: row.dc_note ?? "",
    netPremium: Number(row.nett_premium) || 0,
  };
}

export async function getStagingSoaData(
  customerCode: string,
  branchCode: string,
  minAging?: number
): Promise<StatementOfAccountModel[]> {
  let query = `SELECT * FROM soa_pipeline_staging
     WHERE distribution_code = $1
       AND ($2 = $3 OR branch = $2)`;
  const params: (string | number)[] = [customerCode, branchCode, SENTINEL_ALL];

  if (minAging !== undefined) {
    query += ` AND aging >= $${params.length + 1}`;
    params.push(minAging);
  }

  const result = await executeQuery<StagingRow>(query, params);
  return result.rows.map(mapRow);
}

export async function getStagingSoaDataMinimal(
  customerCode: string,
  branchCode: string
): Promise<StagingMinimalItem[]> {
  const result = await executeQuery<StagingRowMinimal>(
    `SELECT dc_note, branch, nett_premium FROM soa_pipeline_staging
     WHERE distribution_code = $1
       AND ($2 = $3 OR branch = $2)`,
    [customerCode, branchCode, SENTINEL_ALL]
  );

  return result.rows.map(mapRowMinimal);
}
