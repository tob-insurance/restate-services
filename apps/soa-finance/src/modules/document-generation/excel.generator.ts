const hucrePromise = import("hucre/xlsx");

import { CONTENT_TYPES, NUMBER_FORMATS, toExcelDate } from "../../constants";
import type { IStatementOfAccountModel } from "../../types";

export type IExcelColumn = {
  header: string;
  key: ExcelColumnKey;
  width?: number;
  format?: "number" | "currency" | "date" | "text";
};

type ExcelColumnKey = keyof IStatementOfAccountModel;

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
  { header: "Effective Date", key: "endEffDate", width: 12, format: "date" },
  { header: "Expired Date", key: "endExpDate", width: 12, format: "date" },
  { header: "Post Date", key: "postDate", width: 12, format: "date" },
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
  { header: "Due Date", key: "dueDate", width: 12, format: "date" },
];

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

type CellValue = string | number | boolean | Date | null;

function colToLetter(col: number): string {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  let n = col;
  do {
    result = CHARS[n % 26] + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

export async function generateExcel(params: {
  soaData: IStatementOfAccountModel[];
  customerId: string;
}): Promise<ISoaFileResult> {
  const { soaData, customerId } = params;
  const { writeXlsx } = await hucrePromise;

  const fileName = `Outstanding-SOA--${customerId}.xlsx`;

  let processedData = groupAndAggregateSoa(soaData);
  processedData = sortSoaData(processedData);
  const rows: Record<string, CellValue>[] = processedData.map((soa) => {
    const row: Record<string, CellValue> = {};
    for (const col of excelColumns) {
      const rawValue = soa[col.key];
      if (col.format === "date") {
        row[col.key] = toExcelDate(rawValue);
      } else {
        row[col.key] = (rawValue ?? "") as CellValue;
      }
    }
    return row;
  });

  const lastCol = colToLetter(excelColumns.length - 1);
  const lastRow = rows.length + 1;
  const tableRange = `A1:${lastCol}${lastRow}`;

  const numberFormats = new Set(["number", "currency"]);
  const sumColumns = new Set<ExcelColumnKey>([
    "totalSumInsured",
    "grossPremium",
    "discount",
    "commission",
    "ppn",
    "pph21",
    "pph23",
    "cost",
    "stmp",
    "netPremium",
    "netPremiumIdr",
  ]);

  const buffer = await writeXlsx({
    defaultFont: { name: "Calibri", size: 11 },
    sheets: [
      {
        name: "Statement of Account",
        columns: excelColumns.map((col) => ({
          header: col.header,
          key: col.key,
          width: col.width,
          numFmt: col.format ? NUMBER_FORMATS[col.format] : undefined,
          style:
            col.format && numberFormats.has(col.format)
              ? { alignment: { horizontal: "right" } }
              : undefined,
        })),
        data: rows,
        freezePane: { rows: 1 },
        pageSetup: {
          paperSize: "a4",
          orientation: "landscape",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          printTitlesRow: "$1:$1",
        },
        tables: [
          {
            name: "SOA_Table",
            columns: excelColumns.map((col) => ({
              name: col.header,
              totalFunction: sumColumns.has(col.key) ? "sum" : undefined,
            })),
            range: tableRange,
            style: "TableStyleMedium2",
            showRowStripes: true,
            showAutoFilter: true,
            showTotalRow: true,
          },
        ],
      },
    ],
  });

  return {
    fileName,
    contentType: CONTENT_TYPES.XLSX,
    bytes: Buffer.from(buffer),
  };
}
