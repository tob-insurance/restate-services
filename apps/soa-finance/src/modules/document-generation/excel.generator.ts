import { utils, write } from "xlsx";
import { CONTENT_TYPES, NUMBER_FORMATS } from "../../constants";
import type { IStatementOfAccountModel } from "../../types";
import { formatDateDDMMYYYY } from "../../utils/formatter";

export type IExcelColumn = {
  header: string;
  key: string;
  width?: number;
  format?: "number" | "currency" | "date" | "text";
};

type IExcelSheetData = {
  sheetName: string;
  columns: IExcelColumn[];
  rows: Record<string, unknown>[];
};

export type ISoaFileResult = {
  fileName: string;
  contentType: string;
  bytes: Buffer;
};

export const excelColumns: IExcelColumn[] = [
  { header: "DC Note", key: "debitAndCreditNoteNo", width: 18 },
  { header: "Branch", key: "branch", width: 10 },
  { header: "Policy No", key: "policyNo", width: 20 },
  { header: "Policy End No", key: "policyEndNo", width: 15 },
  { header: "Contract No", key: "contractNo", width: 15 },
  { header: "Plat No", key: "plateNo", width: 12 },
  { header: "Batch No", key: "coInFacRefNo", width: 15 },
  {
    header: "Fire Conjunction Policy",
    key: "fireConjunctionPolicy",
    width: 20,
  },
  { header: "LOB", key: "lob", width: 10 },
  { header: "SOB", key: "sourceOfBusiness", width: 10 },
  { header: "Account Name", key: "accountName", width: 30 },
  { header: "Insured Name", key: "insuredName", width: 30 },
  { header: "Distribution Name", key: "distributionName", width: 25 },
  {
    header: "Distribution Second Name",
    key: "distributionNameSecond",
    width: 25,
  },
  { header: "QQ Name", key: "qualitateQuaName", width: 20 },
  { header: "Effective Date", key: "endEffDate", width: 12 },
  { header: "Expired Date", key: "endExpDate", width: 12 },
  { header: "Post Date", key: "postDate", width: 12 },
  { header: "Aging", key: "aging", width: 10 },
  { header: "Currency", key: "currency", width: 10 },
  { header: "Exchange Rate", key: "exchangeRate", width: 12, format: "number" },
  { header: "Endorsement Reason", key: "endReason", width: 20 },
  { header: "Acting Code", key: "actingCode", width: 12 },
  {
    header: "Total Sum Insured",
    key: "totalSumInsured",
    width: 18,
    format: "number",
  },
  { header: "Gross Premium", key: "grossPremium", width: 15, format: "number" },
  { header: "Discount", key: "discount", width: 12, format: "number" },
  { header: "Commission", key: "commission", width: 12, format: "number" },
  { header: "PPN", key: "ppn", width: 12, format: "number" },
  { header: "PPH 21", key: "pph21", width: 12, format: "number" },
  { header: "PPH 23", key: "pph23", width: 12, format: "number" },
  { header: "Cost", key: "cost", width: 12, format: "number" },
  { header: "STMP", key: "stmp", width: 10, format: "number" },
  { header: "Nett Premium", key: "netPremium", width: 15, format: "number" },
  {
    header: "Nett Premium (IDR)",
    key: "netPremiumIdr",
    width: 18,
    format: "number",
  },
  { header: "Installment", key: "installment", width: 12, format: "number" },
  { header: "Due Date", key: "dueDate", width: 12 },
];

type WorksheetType = ReturnType<typeof utils.aoa_to_sheet>;

function applyNumberFormats(
  worksheet: WorksheetType,
  columns: IExcelColumn[],
  rowCount: number
): void {
  for (let rowIdx = 1; rowIdx < rowCount; rowIdx += 1) {
    for (let colIdx = 0; colIdx < columns.length; colIdx += 1) {
      const col = columns[colIdx];
      if (col.format && NUMBER_FORMATS[col.format]) {
        const cellAddress = utils.encode_cell({ r: rowIdx, c: colIdx });
        if (worksheet[cellAddress]) {
          worksheet[cellAddress].z = NUMBER_FORMATS[col.format];
        }
      }
    }
  }
}

function createWorksheet(sheet: IExcelSheetData): WorksheetType {
  const headers = sheet.columns.map((col) => col.header);
  const dataRows = sheet.rows.map((row) =>
    sheet.columns.map((col) => row[col.key] ?? "")
  );

  const worksheetData = [headers, ...dataRows];
  const worksheet = utils.aoa_to_sheet(worksheetData);

  applyNumberFormats(worksheet, sheet.columns, worksheetData.length);

  worksheet["!cols"] = sheet.columns.map((col, colIdx) => {
    if (col.width) {
      return { wch: col.width };
    }

    const maxLen = worksheetData.reduce((prev, row) => {
      const cellValue = row[colIdx];
      const cellLen = cellValue ? cellValue.toString().length : 0;
      return Math.max(prev, cellLen);
    }, 0);

    return { wch: maxLen + 2 };
  });

  return worksheet;
}

function excelGenerate(sheets: IExcelSheetData[]): Buffer {
  const workbook = utils.book_new();

  for (const sheet of sheets) {
    const worksheet = createWorksheet(sheet);
    utils.book_append_sheet(workbook, worksheet, sheet.sheetName);
  }

  const buffer = write(workbook, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buffer);
}

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

function sortSoaData(
  soaData: IStatementOfAccountModel[]
): IStatementOfAccountModel[] {
  return [...soaData].sort((a, b) => {
    if (a.policyNo !== b.policyNo) {
      return (a.policyNo || "").localeCompare(b.policyNo || "");
    }
    if (a.policyEndNo !== b.policyEndNo) {
      return (a.policyEndNo || "").localeCompare(b.policyEndNo || "");
    }
    return (a.installment || "").localeCompare(b.installment || "");
  });
}

export function generateExcel(params: {
  soaData: IStatementOfAccountModel[];
  customerId: string;
}): ISoaFileResult {
  const { soaData, customerId } = params;

  const fileName = `Outstanding-SOA--${customerId}.xlsx`;

  let processedData = groupAndAggregateSoa(soaData);
  processedData = sortSoaData(processedData);
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
    endEffDate: formatDateDDMMYYYY(soa.endEffDate),
    endExpDate: formatDateDDMMYYYY(soa.endExpDate),
    postDate: formatDateDDMMYYYY(soa.postDate),
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
    dueDate: formatDateDDMMYYYY(soa.dueDate),
  }));

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
