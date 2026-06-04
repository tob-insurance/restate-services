import { CONTENT_TYPES } from "../../constants/constants.js";
import { getObjectUrl, uploadFile } from "../../infrastructure/s3";
import type { Account } from "../../types/customer.type.js";
import type { SoaItem, StatementOfAccountModel } from "../../types/soa.type.js";
import { excelSoaName } from "../../utils/formatter/naming.formatter.js";
import { generateExcel } from "./excel-generator.js";
import { generateSoaPdfHandler } from "./generate-soa-pdf.js";
import { buildPdfTemplateData } from "./pdf-template.js";

interface GenerateAndUploadParams {
  branchName: string;
  customerData: Account;
  latestLetter: { letterNo: string; sentDate: Date } | null;
  letterNo: string;
  params: SoaItem;
  pdfFileName: string;
  soaData: StatementOfAccountModel[];
}

interface GenerateAndUploadResult {
  excelFileName: string;
  excelUrl: string;
  pdfFileName: string;
  pdfUrl: string;
}

export async function generateAndUploadDocuments(
  options: GenerateAndUploadParams
): Promise<GenerateAndUploadResult> {
  const {
    soaData,
    customerData,
    params,
    branchName,
    letterNo,
    latestLetter,
    pdfFileName,
  } = options;

  const isReminder = params.processingType > 1;
  const toDate = new Date(params.toDate * 1000);
  const reminderCount = (params.processingType - 1).toString();
  const dateNow = new Date(params.processingDate);

  // Excel and PDF generation are independent — run in parallel
  const templateName = isReminder
    ? "TemplateReminderLetterSOA"
    : "TemplateOutstandingStatementOfAccount";

  const [excelFile, pdfFile] = await Promise.all([
    generateExcel({ soaData, customerId: customerData.code }).then((excel) => {
      excel.fileName = excelSoaName(customerData.code, dateNow);
      return excel;
    }),
    buildPdfTemplateData({
      isReminder,
      toDate,
      customerData,
      branchName,
      soaData,
      letterNo,
      reminderCount,
      latestLetter,
    }).then((templateData) =>
      generateSoaPdfHandler({
        templateName,
        data: templateData,
        filename: pdfFileName,
      })
    ),
  ]);

  // Upload both files to S3 for archival (parallel)
  const [excelUpload, pdfUpload] = await Promise.all([
    uploadFile({ ...excelFile, contentType: CONTENT_TYPES.XLSX }, toDate),
    uploadFile(pdfFile, toDate),
  ]);

  // Generate object URLs (permanent public URLs)
  const excelUrl = getObjectUrl(excelUpload.key);
  const pdfUrl = getObjectUrl(pdfUpload.key);

  return {
    excelFileName: excelFile.fileName,
    excelUrl,
    pdfFileName: pdfFile.fileName,
    pdfUrl,
  };
}
