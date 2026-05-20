import { CONTENT_TYPES } from "../../constants/constants.js";
import { uploadFile } from "../../infrastructure/s3";
import type { IAccount } from "../../types/customer.type.js";
import type {
  IFileData,
  ISoaItem,
  IStatementOfAccountModel,
} from "../../types/soa.type.js";
import { excelSoaName } from "../../utils/formatter/naming.formatter.js";
import { generateExcel } from "./excel.generator";
import { generateSoaPdfHandler } from "./generate-soa-pdf";
import { buildPdfTemplateData } from "./pdf-template";

type GenerateAndUploadParams = {
  soaData: IStatementOfAccountModel[];
  customerData: IAccount;
  params: ISoaItem;
  branchName: string;
  letterNo: string;
  latestLetter: { letterNo: string; sentDate: Date } | null;
  pdfFileName: string;
};

type GenerateAndUploadResult = {
  excelFile: IFileData;
  pdfFile: IFileData;
};

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
  await Promise.all([
    uploadFile(
      { ...excelFile, contentType: CONTENT_TYPES.XLSX },
      customerData.code,
      "excel",
      toDate
    ),
    uploadFile(pdfFile, customerData.code, "pdf", toDate),
  ]);

  return { excelFile, pdfFile };
}
