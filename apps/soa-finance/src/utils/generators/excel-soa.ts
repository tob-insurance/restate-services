import { CONTENT_TYPES, excelColumns } from "../../constants";
import type { IStatementOfAccountModel } from "../../types";
import { excelGenerate } from "./excel-generator";
import type { ISoaFileResult } from "./types";

type GenerateSoaExcelParams = {
  soaData: IStatementOfAccountModel[];
  customerId: string;
};

function groupAndAggregateSoa(
  soaData: IStatementOfAccountModel[]
): IStatementOfAccountModel[] {
  if (soaData.length === 0) {
    return [];
  }

  // Check if customer is Insurance Broker (IB*)
  const firstActingCode = soaData[0]?.actingCode || "";
  const isInsuranceBroker = firstActingCode.startsWith("IB");

  // If IB, no grouping needed - return as-is
  if (isInsuranceBroker) {
    return soaData;
  }

  // Group by PolicyNo-PolicyEndNo-Installment
  const groupMap = new Map<string, IStatementOfAccountModel[]>();

  for (const soa of soaData) {
    const groupKey = `${soa.policyNo}-${soa.policyEndNo}-${soa.installment}`;

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, []);
    }
    groupMap.get(groupKey)?.push(soa);
  }

  // Aggregate each group
  const aggregatedData: IStatementOfAccountModel[] = [];

  for (const group of groupMap.values()) {
    if (group.length === 0) {
      continue;
    }

    // Take first record as base
    const base = { ...group[0] };

    // Aggregate financial fields from remaining records
    for (let i = 1; i < group.length; i++) {
      const record = group[i];
      base.grossPremium += record.grossPremium;
      base.discount += record.discount;
      base.commission += record.commission;
      base.ppn += record.ppn;
      base.pph21 += record.pph21;
      base.pph23 += record.pph23;
      base.cost += record.cost;
      base.stmp += record.stmp;
      base.netPremium += record.netPremium;
      base.netPremiumIdr += record.netPremiumIdr;
    }

    // Clear DC Note (as per C# logic)
    base.debitAndCreditNoteNo = "";

    aggregatedData.push(base);
  }

  return aggregatedData;
}

/**
 * Sorts SOA data by PolicyNo, PolicyEndNo, and Installment.
 */
function sortSoaData(
  soaData: IStatementOfAccountModel[]
): IStatementOfAccountModel[] {
  return [...soaData].sort((a, b) => {
    // Sort by PolicyNo
    if (a.policyNo !== b.policyNo) {
      return a.policyNo.localeCompare(b.policyNo);
    }
    // Then by PolicyEndNo
    if (a.policyEndNo !== b.policyEndNo) {
      return a.policyEndNo.localeCompare(b.policyEndNo);
    }
    // Finally by Installment
    return a.installment.localeCompare(b.installment);
  });
}

/**
 * Converts timestamp (milliseconds or string) to DD/MM/YYYY format
 */
export function formatTimestampToDate(value: string | number): string {
  if (!value) {
    return "";
  }

  // If it's a string that looks like a timestamp, convert to number
  const timestamp =
    typeof value === "string" ? Number.parseInt(value, 10) : value;

  if (Number.isNaN(timestamp)) {
    return value.toString();
  }

  const date = new Date(timestamp);
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

export function generateExcel(params: GenerateSoaExcelParams): ISoaFileResult {
  const { soaData, customerId } = params;

  const fileName = `Outstanding-SOA--${customerId}.xlsx`;

  // Step 1: Group and aggregate (for non-IB customers)
  let processedData = groupAndAggregateSoa(soaData);

  // Step 2: Sort data
  processedData = sortSoaData(processedData);

  // Step 3: Map to Excel rows
  const rows: Record<string, unknown>[] = processedData.map((soa) => ({
    debitAndCreditNoteNo: soa.debitAndCreditNoteNo,
    branch: soa.branch,
    policyNo: soa.policyNo,
    policyEndNo: soa.policyEndNo,
    contractNo: soa.contractNo,
    plateNo: soa.plateNo,
    coInFacRefNo: soa.coInFacRefNo,
    fireConjunctionPolicy: soa.fireConjunctionPolicy,
    lob: soa.lob,
    sourceOfBusiness: soa.sourceOfBusiness,
    accountName: soa.accountName,
    insuredName: soa.insuredName,
    distributionName: soa.distributionName,
    distributionNameSecond: soa.distributionNameSecond,
    qualitateQuaName: soa.qualitateQuaName,
    endEffDate: formatTimestampToDate(soa.endEffDate),
    endExpDate: formatTimestampToDate(soa.endExpDate),
    postDate: formatTimestampToDate(soa.postDate),
    aging: soa.aging,
    currency: soa.currency,
    exchangeRate: soa.exchangeRate,
    endReason: soa.endReason,
    actingCode: soa.actingCode,
    totalSumInsured: soa.totalSumInsured,
    grossPremium: soa.grossPremium,
    discount: soa.discount,
    commission: soa.commission,
    ppn: soa.ppn,
    pph21: soa.pph21,
    pph23: soa.pph23,
    cost: soa.cost,
    stmp: soa.stmp,
    netPremium: soa.netPremium,
    netPremiumIdr: soa.netPremiumIdr,
    installment: soa.installment,
    dueDate: formatTimestampToDate(soa.dueDate),
  }));

  // Step 4: Generate Excel buffer
  const buffer = excelGenerate([
    {
      sheetName: "Statement of Account",
      columns: excelColumns,
      rows,
    },
  ]);

  return {
    fileName,
    contentType: CONTENT_TYPES.XLSX,
    bytes: buffer,
  };
}
