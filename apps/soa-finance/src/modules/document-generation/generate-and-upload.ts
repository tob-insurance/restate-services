import { uploadFile } from "../../infrastructure/azure";
import type {
  IAccount,
  IFileData,
  ISoaItem,
  IStatementOfAccountModel,
} from "../../types";
import { excelSoaName } from "../../utils/formatter";
import { generateExcel } from "./excel.generator";
import { generateSoaPdfHandler } from "./generate-soa-pdf";
import { buildPdfTemplateData } from "./pdf-template";

const PDF_EXTENSION_REGEX = /\.pdf$/;

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

  const excelFile = generateExcel({
    soaData,
    customerId: customerData.code,
  });
  const excelFileName = excelSoaName(customerData.code, dateNow);
  excelFile.fileName = excelFileName;

  const templateName = isReminder
    ? "TemplateReminderLetterSOA"
    : "TemplateOutstandingStatementOfAccount";

  const templateData = await buildPdfTemplateData({
    isReminder,
    toDate,
    customerData,
    branchName,
    soaData,
    letterNo,
    reminderCount,
    latestLetter,
  });

  const pdfFileNameWithoutExt = pdfFileName.replace(PDF_EXTENSION_REGEX, "");
  const pdfResult = await generateSoaPdfHandler({
    templateName,
    data: templateData,
    filename: pdfFileNameWithoutExt,
  });

  const pdfFile: IFileData = {
    fileName: pdfFileName,
    bytes: Buffer.from(pdfResult.bytes as string, "base64"),
    contentType: "application/pdf",
  };

  await uploadFile(
    {
      ...excelFile,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    customerData.code,
    "excel"
  );

  await uploadFile(pdfFile, customerData.code, "pdf");

  return { excelFile, pdfFile };
}
