import type { WorkflowContext } from "@restatedev/restate-sdk";
import { uploadFile } from "../../infrastructure/azure";
import {
  completeJobPhase,
  getDcNoteIdsByCustomer,
  insertJobPhase,
} from "../../infrastructure/database/index.js";
import { readSoaParquet } from "../../pipeline/lib";
import {
  type IAccount,
  type IStatementOfAccountModel,
  SoaPhase,
} from "../../types";
import { excelSoaName } from "../../utils/formatter";
import { generateExcel } from "../document-generation/excel.generator";

type GenerateSoaOptions = {
  ctx: WorkflowContext;
  branchCode: string;
  customer: IAccount;
  classOfBusiness: string;
  dateNow: Date;
  jobId: string;
  processingType: number;
  skipAgingFilter?: boolean;
  skipDcNoteCheck?: boolean;
};

export const generateSoa = async (
  options: GenerateSoaOptions
): Promise<IStatementOfAccountModel[] | null> => {
  const {
    ctx,
    branchCode,
    customer,
    classOfBusiness,
    jobId,
    skipAgingFilter = false,
    skipDcNoteCheck = false,
  } = options;

  ctx.console.log(
    `GenerateSOA started for ${customer.code}, Branch: ${branchCode}, COB: ${classOfBusiness}`
  );

  // ========== Phase: Get SOA Data ==========
  await insertJobPhase(jobId, SoaPhase.GetSoa);

  let soaList = await ctx.run("read-parquet", async () => {
    console.log(`Getting SOA data for ${customer.code}`);
    return await readSoaParquet(customer.code, branchCode);
  });

  // Filter Aging (Outstanding > 60 Days by default)
  // biome-ignore lint/suspicious/useAwait: Async required by ctx.run signature
  soaList = await ctx.run("filter-aging", async () => {
    if (skipAgingFilter) {
      console.log(
        `[AgingFilter] DISABLED for ${customer.code} - keeping all ${soaList.length} records`
      );
      return soaList;
    }
    const filtered = soaList.filter((soa) => soa.aging >= 60);
    console.log(
      `[AgingFilter] ENABLED for ${customer.code}: Filtered ${soaList.length} down to ${filtered.length} SOA records (aging >= 60 days)`
    );
    return filtered;
  });

  await completeJobPhase(jobId, SoaPhase.GetSoa);

  if (soaList.length === 0) {
    ctx.console.log(`Skipping ${customer.code}: No SOA records found`);
    return null;
  }

  // Extract unique DC notes (O(N) with Set)
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

    let processedDcNotes: string[];
    if (skipDcNoteCheck) {
      processedDcNotes = dcNotes;
      console.log(
        `Skip DC note check enabled - processing all ${processedDcNotes.length} DC notes`
      );
    } else {
      // Optimization: Use a Set of lowercased existing IDs for O(1) lookup
      const existingSet = new Set(
        existingDcNotes.map((id) => id.toLowerCase())
      );

      processedDcNotes = dcNotes.filter(
        (note) => !existingSet.has(note.toLowerCase())
      );

      if (processedDcNotes.length === 0) {
        console.log(
          `Skipping ${customer.code}: All DC notes already processed`
        );
        return [];
      }
      console.log(
        `Processing ${processedDcNotes.length} new DC notes (filtered)`
      );
    }

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

  // ========== Phase: Generate & Upload Files ==========

  // Excel: Generate and Upload in one durable step to avoid binary serialization issues
  await ctx.run("generate-and-upload-excel", async () => {
    await insertJobPhase(jobId, SoaPhase.GeneratingFiles);

    console.log(`Generating Excel for ${customer.code}`);
    const excelFile = generateExcel({
      soaData: soaList,
      customerId: customer.code,
    });
    excelFile.fileName = excelSoaName(customer.code, options.dateNow);

    console.log(`Uploading Excel for ${customer.code}`);
    await uploadFile(excelFile, customer.code, "excel");

    await completeJobPhase(jobId, SoaPhase.GeneratingFiles);
  });

  ctx.console.log(
    `Files generated and uploaded successfully for ${customer.code}`
  );

  return soaList;
};
