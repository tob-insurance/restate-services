import {
  parseDate,
  parseNumber,
  parseString,
} from "../../../module/utils/formatter";
import {
  column,
  type IStatementOfAccountModel,
} from "../../../module/utils/types";

export function transformSoaRow(
  row: unknown[]
): IStatementOfAccountModel | null {
  if (!row || row.length < 37) {
    return null;
  }

  const netPremium = parseNumber(row[column.NETT_PREMIUM]);
  const exchangeRate = parseNumber(row[column.EXCH_RATE]) || 1;
  const aging = parseNumber(row[column.AGING]);

  if (netPremium === 0) {
    return null;
  }

  return {
    debitAndCreditNoteNo: parseString(row[column.DC_NOTE]),
    branch: parseString(row[column.BRANCH]),
    policyNo: parseString(row[column.POLICY_NO]),
    policyEndNo: parseString(row[column.POL_END_NO]),
    contractNo: parseString(row[column.CONTRACT_NO]),
    plateNo: parseString(row[column.PLAT_NO]),
    coInFacRefNo: parseString(row[column.CO_IN_FAC_REF_NO]),
    fireConjunctionPolicy: parseString(row[column.FIRE_CONJUNCTION_POL]),
    lob: parseString(row[column.LOB]),
    sourceOfBusiness: parseString(row[column.SOB]),
    accountName: parseString(row[column.DC_ACCOUNT_FULL_NAME]),
    insuredName: parseString(row[column.INSURED_NAME]),
    distributionName: parseString(row[column.DISTRIBUTION_NAME]),
    distributionNameSecond: parseString(row[column.DISTRIBUTION_NAME2]),
    qualitateQuaName: parseString(row[column.QQ_NAME]),
    endEffDate: parseDate(row[column.END_EFF_DATE]),
    endExpDate: parseDate(row[column.END_EXP_DATE]),
    postDate: parseDate(row[column.POST_DATE]),
    dueDate: parseDate(row[column.DUE_DATE]),
    aging,
    currency: parseString(row[column.CURR]),
    exchangeRate,
    endReason: parseString(row[column.END_REASON]),
    actingCode: parseString(row[column.ACTING_CODE]),
    totalSumInsured: parseNumber(row[column.TSI]),
    grossPremium: parseNumber(row[column.GP]),
    discount: parseNumber(row[column.DISC]),
    commission: parseNumber(row[column.COMM]),
    ppn: parseNumber(row[column.PPN]),
    pph21: parseNumber(row[column.PPH21]),
    pph23: parseNumber(row[column.PPH23]),
    cost: parseNumber(row[column.COST]),
    stmp: parseNumber(row[column.STMP]),
    netPremium,
    netPremiumIdr: netPremium * exchangeRate,
    installment: parseString(row[column.INST_NO]),
    origAmount: parseNumber(row[column.ORIG_AMOUNT]),
    dcNoteNo: parseString(row[column.DC_NOTE]),
    classOfBusiness: parseString(row[column.LOB]),
    customerCode: parseString(row[column.DISTRIBUTION_NAME]),
    officeCode: parseString(row[column.BRANCH]),
    distributionCode: parseString(row[column.DISTRIBUTION_CODE]),
  };
}
