import type { ObjectContext } from "@restatedev/restate-sdk";
import { TerminalError } from "@restatedev/restate-sdk";
import { AGING_THRESHOLD } from "../../../constants/constants.js";
import { isDevelopment } from "../../../constants/environment.js";
import { getAllBranches } from "../../../infrastructure/database/queries/branch-query.js";
import type { Branch } from "../../../infrastructure/database/types.js";
import type { Account } from "../../../types/customer.type.js";
import type { FileData, SoaItem } from "../../../types/soa.type.js";
import { letterSoaPdfName } from "../../../utils/formatter/naming.formatter.js";
import { getStagingSoaData } from "../../data-access/staging-reader.js";
import { generateAndUploadDocuments } from "../../document-generation/index.js";
import { sendSoaEmail } from "../../email/index.js";
import { createReminder } from "../../reminder/index.js";
import { multiBranchCodes } from "../types.js";

export interface ProcessSoaParams {
  ctx: ObjectContext;
  customerData: Account;
  params: SoaItem;
}

interface BranchResult {
  hasDocuments: boolean;
}

interface BranchProcessResult {
  branch: Branch;
  hasDocuments: boolean;
}

/**
 * Process a single branch: read staging, filter aging, generate docs, send email.
 * Uses two ctx.run() calls to minimize journal size:
 *   1. Generate + upload + create reminder
 *   2. Send email
 * Always returns a result — errors are caught and logged (branch error isolation).
 */
async function processSingleBranch(
  params: ProcessSoaParams,
  branch: Branch
): Promise<BranchProcessResult> {
  const { ctx, customerData, params: soaParams } = params;
  const dateNow = new Date(soaParams.processingDate);
  const startTime = await ctx.date.now();

  // ctx.run() #1: Read staging, filter, generate docs, upload to S3
  let generated: {
    excelFile: FileData;
    pdfFile: FileData;
    count: number;
    dcNoteNos: string[];
  } | null;
  ctx.console.log(
    `Processing branch ${branch.officeCode} for customer ${customerData.code}`
  );

  try {
    generated = await ctx.run(
      `generate-upload-${branch.officeCode}`,
      async () => {
        const soaData = await getStagingSoaData(
          customerData.code,
          branch.officeCode,
          AGING_THRESHOLD
        );

        if (soaData.length === 0) {
          return null;
        }

        const result = await generateAndUploadDocuments({
          soaData,
          customerData,
          params: soaParams,
          branchName: branch.name,
          letterNo: "",
          latestLetter: null,
          pdfFileName: letterSoaPdfName(customerData.code),
        });

        const dcNoteNos = soaData.map((s) => s.debitAndCreditNoteNo);

        return {
          excelFile: result.excelFile,
          pdfFile: result.pdfFile,
          count: soaData.length,
          dcNoteNos,
        };
      }
    );
  } catch (error: unknown) {
    if (error instanceof TerminalError) {
      throw error;
    }
    ctx.console.log(
      `[Branch] Failed generate/upload for ${branch.officeCode}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return { branch, hasDocuments: false };
  }

  if (!generated) {
    ctx.console.log(`[Branch] No SOA data for ${branch.officeCode}`);
    return { branch, hasDocuments: false };
  }

  // Create reminder OUTSIDE ctx.run() to avoid nested context calls
  const dcNoteNos = generated.dcNoteNos;
  if (dcNoteNos.length > 0) {
    await createReminder({
      customer: customerData,
      timePeriod: soaParams.timePeriod,
      branchCode: branch.officeCode,
      processingDate: soaParams.processingDate,
      dcNoteNos,
      ctx,
    });
  }

  ctx.console.log(
    `SOA generated for ${customerData.code} branch ${branch.officeCode}: ${generated.count} records`
  );

  // ctx.run() #2: Send email with buffers directly (skip S3 download)
  try {
    await ctx.run(`send-email-${branch.officeCode}`, async () => {
      await sendSoaEmail({
        customerData,
        date: dateNow,
        isReminder: false,
        excelFile: generated.excelFile,
        pdfFile: generated.pdfFile,
      });
    });
  } catch (error: unknown) {
    if (error instanceof TerminalError) {
      throw error;
    }
    ctx.console.log(
      `[Branch] Failed email send for ${branch.officeCode}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return { branch, hasDocuments: false };
  }

  const duration = (await ctx.date.now()) - startTime;
  ctx.console.log(
    { component: "Branch", branch: branch.officeCode, durationMs: duration },
    `Branch ${branch.officeCode} completed in ${duration}ms`
  );

  return { branch, hasDocuments: true };
}

/**
 * Process SOA for a customer across one or more branches.
 * Uses sequential processing for deterministic journal ordering — each branch handles its own errors
 * internally and always returns a result (branch error isolation).
 */
export async function processBranchSoa(
  params: ProcessSoaParams
): Promise<BranchResult> {
  const { ctx, customerData } = params;
  const isMultiBranch =
    !isDevelopment() && multiBranchCodes.includes(customerData.actingCode);

  const branches: Branch[] = isMultiBranch
    ? await ctx.run("get-branches", async () => await getAllBranches())
    : [{ officeCode: params.params.branch, name: params.params.branch }];

  if (isMultiBranch) {
    ctx.console.log(`Processing ${branches.length} branches in parallel`);
  }

  // Sequential processing — each branch catches errors to isolate failures
  // (one branch failure doesn't kill the customer)
  const results: BranchProcessResult[] = [];
  for (const branch of branches) {
    try {
      results.push(await processSingleBranch(params, branch));
    } catch (error) {
      ctx.console.log(
        `[Branch] Unhandled error for ${branch.officeCode}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      results.push({ branch, hasDocuments: false });
    }
  }

  return { hasDocuments: results.some((r) => r.hasDocuments) };
}
