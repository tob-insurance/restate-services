type ReportFormat = "pdf" | "xlsx" | "html";
type FileFormat = "A4" | "Letter" | "Legal";

export type IReportOptions = {
  format?: FileFormat;
  landscape?: boolean;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  headerTemplate?: string;
  footerTemplate?: string;
  displayHeaderFooter?: boolean;
};

export type IExcelColumn = {
  header: string;
  key: string;
  width?: number;
  format?: "number" | "currency" | "date" | "text";
};

export type IExcelSheetData = {
  sheetName: string;
  columns: IExcelColumn[];
  rows: Record<string, unknown>[];
};

export type IGenerateReportParams = {
  template: string;
  data: Record<string, unknown>;
  format: ReportFormat;
  filename: string;
  options?: IReportOptions;
  excelColumns?: IExcelColumn[];
  excelDataKey?: string;
};

export type IReportResult = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};

export type ISoaFileResult = {
  fileName: string;
  contentType: string;
  bytes: Buffer;
};
