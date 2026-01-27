/**
 * Generate SOA files (Excel + PDF) and upload to Azure
 */

import { readSoaParquet } from "../../../data-pipeline/lib";
import { uploadFile } from "../../../infrastructure/azure";
import {
  completeJobPhase,
  getDcNoteIdsByCustomer,
  insertJobPhase,
} from "../../../infrastructure/database/queries";
import { generateExcel } from "../../utils/generators";
import { generateCollectionPdf } from "../../utils/generators/pdf/generate-collection-pdf";
import {
  type IAccount,
  type IStatementOfAccountModel,
  SoaPhase,
} from "../../utils/types";

type GenerateSoaOptions = {
  branchCode: string;
  customer: IAccount;
  classOfBusiness: string;
  dateNow: Date;
  toDate: number;
  jobId: string;
  testMode?: boolean;
  skipAgingFilter?: boolean;
  skipDcNoteCheck?: boolean;
};

export const generateSoa = async (
  options: GenerateSoaOptions
): Promise<IStatementOfAccountModel[] | null> => {
  const {
    branchCode,
    customer,
    classOfBusiness,
    toDate,
    jobId,
    skipAgingFilter = false,
    skipDcNoteCheck = false,
  } = options;

  console.log(
    `GenerateSOA started for ${customer.code}, Branch: ${branchCode}, COB: ${classOfBusiness}`
  );

  // ========== Phase: Get SOA Data ==========
  await insertJobPhase(jobId, SoaPhase.GetSoa);
  console.log(`Getting SOA data for ${customer.code}`);
  const fullName = customer.fullName.replace(/\s+/g, "");

  const toDateObj = new Date(toDate * 1000);
  let soaList = await readSoaParquet(fullName);

  // Filter by aging >= 60 days (skip if skipAgingFilter is true)
  if (skipAgingFilter) {
    console.log(
      `Skip aging filter enabled - keeping all ${soaList.length} records`
    );
  } else {
    soaList = soaList.filter((soa) => Number.parseInt(soa.aging, 10) >= 60);
    console.log(
      `Filtered to ${soaList.length} SOA records with aging >= 60 days`
    );
  }

  await completeJobPhase(jobId, SoaPhase.GetSoa);

  if (soaList.length === 0) {
    console.log(`Skipping ${customer.code}: No SOA records found`);
    return null;
  }

  // Extract DC notes
  const dcNotes = soaList
    .flatMap((soa) => soa.debitAndCreditNoteNo?.split(",") || [])
    .filter((note, idx, arr) => arr.indexOf(note) === idx);

  console.log(`Extracted ${dcNotes.length} unique DC notes`);

  // Get existing DC notes from previous reminders
  const existingDcNotes = await getDcNoteIdsByCustomer(customer.code);
  console.log(`Found ${existingDcNotes.length} DC notes in previous reminders`);

  // Filter out already processed DC notes (skip if skipDcNoteCheck is true)
  let newDcNotes: string[];
  if (skipDcNoteCheck) {
    newDcNotes = dcNotes;
    console.log(
      `Skip DC note check enabled - processing all ${newDcNotes.length} DC notes`
    );
  } else {
    newDcNotes = dcNotes.filter(
      (note) =>
        !existingDcNotes.some(
          (existing) => existing.toLowerCase() === note.toLowerCase()
        )
    );

    if (newDcNotes.length === 0) {
      console.log(`Skipping ${customer.code}: All DC notes already processed`);
      return null;
    }
    console.log(`Processing ${newDcNotes.length} new DC notes (filtered)`);
  }

  // Filter soaList to only include new DC notes
  soaList = soaList.filter((soa) =>
    newDcNotes.includes(soa.debitAndCreditNoteNo)
  );

  if (soaList.length === 0) {
    console.log(
      `Skipping ${customer.code}: No matching SOA records after filter`
    );
    return null;
  }

  // Phase complete - data ready for file generation
  console.log(`SOA data ready for ${customer.code}: ${soaList.length} records`);

  // ========== Phase: Generate Files ==========
  await insertJobPhase(jobId, SoaPhase.GeneratingFiles);
  console.log(`Generating Excel and PDF files for ${customer.code}`);

  const dateStr = toDateObj.toISOString().split("T")[0];

  // Generate Excel file
  const excelFile = await generateExcel({
    soaData: soaList,
    customerId: customer.code,
  });
  console.log(`Generated Excel: ${excelFile.fileName}`);

  // Generate PDF file
  const pdfFile = await generateCollectionPdf(
    customer.code,
    customer.fullName,
    dateStr,
    customer.virtualAccount || "-"
  );
  console.log(`Generated PDF: ${pdfFile.fileName}`);

  await completeJobPhase(jobId, SoaPhase.GeneratingFiles);

  // ========== Phase: Upload to Azure ==========
  await insertJobPhase(jobId, SoaPhase.UploadingToAzure);
  console.log(`Uploading files to Azure for ${customer.code}`);

  const excelUploadResult = await uploadFile(excelFile, customer.code, "excel");
  console.log(`Excel uploaded: ${excelUploadResult.blobName}`);

  const pdfUploadResult = await uploadFile(pdfFile, customer.code, "pdf");
  console.log(`PDF uploaded: ${pdfUploadResult.blobName}`);

  await completeJobPhase(jobId, SoaPhase.UploadingToAzure);
  console.log(`Files uploaded successfully for ${customer.code}`);

  return soaList;
};
