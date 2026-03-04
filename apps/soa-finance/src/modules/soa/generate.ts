import type { WorkflowContext } from "@restatedev/restate-sdk";
import { uploadFile } from "../../infrastructure/azure";
import { getDcNoteIdsByCustomer } from "../../infrastructure/database/index.js";
import { readSoaParquet } from "../../pipeline/lib";
import type { IAccount, IStatementOfAccountModel } from "../../types";
import { excelSoaName } from "../../utils/formatter";
import { generateExcel } from "../document-generation/excel.generator";

type GenerateSoaOptions = {
  ctx: WorkflowContext;
  branchCode: string;
  customer: IAccount;
  classOfBusiness: string;
  dateNow: Date;
  processingType: number;
};

export const generateSoa = async (
  options: GenerateSoaOptions
): Promise<IStatementOfAccountModel[] | null> => {
  const { ctx, branchCode, customer, classOfBusiness } = options;

  ctx.console.log(
    `GenerateSOA started for ${customer.code}, Branch: ${branchCode}, COB: ${classOfBusiness}`
  );

  // ========== Get SOA Data ==========
  let soaList = await ctx.run("read-parquet", async () => {
    console.log(`Getting SOA data for ${customer.code}`);
    return await readSoaParquet(customer.code, branchCode);
  });

  // Filter Aging (Outstanding >= 60 Days)
  soaList = await ctx.run("filter-aging", () => {
    const filtered = soaList.filter((soa) => soa.aging >= 60);
    console.log(
      `[AgingFilter] ${customer.code}: Filtered ${soaList.length} down to ${filtered.length} SOA records (aging >= 60 days)`
    );
    return filtered;
  });

  if (soaList.length === 0) {
    ctx.console.log(`Skipping ${customer.code}: No SOA records found`);
    return null;
  }

  // Extract unique DC notes and filter already-processed ones
  const newSoaList = await ctx.run("filter-dc-notes", async () => {
    const dcNotesSet = new Set(
      soaList.flatMap((soa) => soa.debitAndCreditNoteNo?.split(",") || [])
    );
    const dcNotes = Array.from(dcNotesSet);
    console.log(`Extracted ${dcNotes.length} unique DC notes`);

    const existingDcNotes = await getDcNoteIdsByCustomer(customer.code);
    console.log(
      `Found ${existingDcNotes.length} DC notes in previous reminders`
    );

    const existingSet = new Set(existingDcNotes.map((id) => id.toLowerCase()));

    const processedDcNotes = dcNotes.filter(
      (note) => !existingSet.has(note.toLowerCase())
    );

    if (processedDcNotes.length === 0) {
      console.log(`Skipping ${customer.code}: All DC notes already processed`);
      return [];
    }
    console.log(
      `Processing ${processedDcNotes.length} new DC notes (filtered)`
    );

    const processedSet = new Set(processedDcNotes);
    return soaList.filter((soa) => processedSet.has(soa.debitAndCreditNoteNo));
  });

  if (newSoaList.length === 0) {
    ctx.console.log(
      `Skipping ${customer.code}: No matching SOA records after filter`
    );
    return null;
  }

  soaList = newSoaList;
  ctx.console.log(
    `SOA data ready for ${customer.code}: ${soaList.length} records`
  );

  // ========== Generate & Upload Files ==========

  // Excel: Generate and Upload in one durable step to avoid binary serialization issues
  await ctx.run("generate-and-upload-excel", async () => {
    console.log(`Generating Excel for ${customer.code}`);
    const excelFile = generateExcel({
      soaData: soaList,
      customerId: customer.code,
    });
    excelFile.fileName = excelSoaName(customer.code, options.dateNow);

    console.log(`Uploading Excel for ${customer.code}`);
    await uploadFile(excelFile, customer.code, "excel");
  });

  ctx.console.log(
    `Files generated and uploaded successfully for ${customer.code}`
  );

  return soaList;
};
