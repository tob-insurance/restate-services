import { utils, write } from "xlsx";
import { NUMBER_FORMATS } from "../../constants";
import type { IExcelColumn, IExcelSheetData } from "./types";

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

  // Implement Autofit
  worksheet["!cols"] = sheet.columns.map((col, colIdx) => {
    // If width is explicitly provided, use it
    if (col.width) {
      return { wch: col.width };
    }

    // Otherwise, calculate the maximum length in this column
    const maxLen = worksheetData.reduce((prev, row) => {
      const cellValue = row[colIdx];
      const cellLen = cellValue ? cellValue.toString().length : 0;
      return Math.max(prev, cellLen);
    }, 0);

    // Set width to max length found + small padding
    return { wch: maxLen + 2 };
  });

  return worksheet;
}

export function excelGenerate(sheets: IExcelSheetData[]): Buffer {
  const workbook = utils.book_new();

  for (const sheet of sheets) {
    const worksheet = createWorksheet(sheet);
    utils.book_append_sheet(workbook, worksheet, sheet.sheetName);
  }

  const buffer = write(workbook, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buffer);
}
