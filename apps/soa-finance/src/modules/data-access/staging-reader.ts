import { SENTINEL_ALL } from "../../constants/constants.js";
import { getPostgresClient } from "../../infrastructure/database/postgres.js";
import type { IStatementOfAccountModel } from "../../types/soa.type.js";

type StagingRow = {
  branch: string;
  policy_no: string;
  pol_end_no: string;
  contract_no: string;
  plat_no: string;
  co_in_fac_ref_no: string;
  fire_conjunction_pol: string;
  lob: string;
  sob: string;
  dc_account_full_name: string;
  insured_name: string;
  distribution_name: string;
  distribution_name2: string;
  qq_name: string;
  end_eff_date: string;
  end_exp_date: string;
  post_date: string;
  aging: number;
  curr: string;
  exch_rate: number;
  end_reason: string;
  acting_code: string;
  tsi: number;
  gp: number;
  disc: number;
  comm: number;
  ppn: number;
  pph21: number;
  pph23: number;
  cost: number;
  stmp: number;
  nett_premium: number;
  inst_no: string;
  due_date: string;
  dc_note: string;
  orig_amount: number;
  distribution_code: string;
};

function mapRow(row: StagingRow): IStatementOfAccountModel {
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

export async function getStagingSoaData(
  customerCode: string,
  branchCode: string
): Promise<IStatementOfAccountModel[]> {
  const client = getPostgresClient();
  const result = await client.executeQuery<StagingRow>(
    `SELECT * FROM soa_pipeline_staging
     WHERE distribution_code = $1
       AND ($2 = $3 OR branch = $2)`,
    [customerCode, branchCode, SENTINEL_ALL]
  );

  return result.rows.map(mapRow);
}
