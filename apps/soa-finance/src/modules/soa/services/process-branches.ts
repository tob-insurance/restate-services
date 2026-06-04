import type { ObjectContext } from "@restatedev/restate-sdk";
import { TerminalError } from "@restatedev/restate-sdk";
import { isDevelopment } from "../../../constants/environment.js";
import { getAllBranches } from "../../../infrastructure/database/queries/branch-query.js";
import type { Branch } from "../../../infrastructure/database/types.js";
import type { Account } from "../../../types/customer.type.js";
import type { SoaItem } from "../../../types/soa.type.js";
import { letterSoaPdfName } from "../../../utils/formatter/naming.formatter.js";
import { getStagingSoaData } from "../../data-access/staging-reader.js";
import { generateAndUploadDocuments } from "../../document-generation/index.js";
import { sendSoaEmail } from "../../email/index.js";
import { createReminder } from "../../reminder/index.js";
import { filterAgingData } from "../fetch-soa-data.js";
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
 * Returns null on non-terminal failures (branch error isolation).
 */
async function processSingleBranch(
  params: ProcessSoaParams,
  branch: Branch
): Promise<BranchProcessResult | null> {
  const { ctx, customerData, params: soaParams } = params;
  const dateNow = new Date(soaParams.processingDate);
  const startTime = await ctx.date.now();

  // ctx.run() #1: Read staging, filter, generate docs, upload to S3
  let generated: {
    excelFileName: string;
    excelUrl: string;
    pdfFileName: string;
    pdfUrl: string;
    count: number;
  } | null;
  try {
    generated = await ctx.run(
      `generate-upload-${branch.officeCode}`,
      async () => {
        const rawSoaList = await getStagingSoaData(
          customerData.code,
          branch.officeCode
        );
        const soaData = filterAgingData(rawSoaList);

        if (!soaData || soaData.length === 0) {
          return null;
        }

        ctx.console.log(
          `Processing branch ${branch.officeCode} for customer ${customerData.code}`
        );

        const result = await generateAndUploadDocuments({
          soaData,
          customerData,
          params: soaParams,
          branchName: branch.name,
          letterNo: "",
          latestLetter: null,
          pdfFileName: letterSoaPdfName(customerData.code),
        });

        // Create reminder inside callback — dcNoteNos never leaves this scope
        const dcNoteNos = soaData.map((s) => s.debitAndCreditNoteNo);
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

        return {
          excelFileName: result.excelFileName,
          excelUrl: result.excelUrl,
          pdfFileName: result.pdfFileName,
          pdfUrl: result.pdfUrl,
          count: soaData.length,
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
    return null;
  }

  if (!generated) {
    ctx.console.log(`[Branch] No SOA data for ${branch.officeCode}`);
    return { branch, hasDocuments: false };
  }

  ctx.console.log(
    `SOA generated for ${customerData.code} branch ${branch.officeCode}: ${generated.count} records`
  );

  // ctx.run() #2: Send email with S3 object URLs
  try {
    await ctx.run(`send-email-${branch.officeCode}`, async () => {
      await sendSoaEmail({
        customerData,
        date: dateNow,
        isReminder: false,
        excelFileName: generated.excelFileName,
        excelUrl: generated.excelUrl,
        pdfFileName: generated.pdfFileName,
        pdfUrl: generated.pdfUrl,
      });
    });
  } catch (error: unknown) {
    if (error instanceof TerminalError) {
      throw error;
    }
    ctx.console.log(
      `[Branch] Failed email send for ${branch.officeCode}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return null;
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
 * Uses try/catch for error isolation — one branch failure doesn't kill the customer.
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
    ctx.console.log(`Processing ${branches.length} branches`);
  }

  const results: BranchProcessResult[] = [];

  for (const branch of branches) {
    const result = await processSingleBranch(params, branch);
    if (result) {
      results.push(result);
    }
  }

  return { hasDocuments: results.some((r) => r.hasDocuments) };
}
