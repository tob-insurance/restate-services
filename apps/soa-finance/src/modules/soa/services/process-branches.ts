import type { ObjectContext } from "@restatedev/restate-sdk";
import { TerminalError } from "@restatedev/restate-sdk";
import { isDevelopment } from "../../../constants/environment.js";
import { getAllBranches } from "../../../infrastructure/database/queries/branch-query.js";
import type { Branch } from "../../../infrastructure/database/types.js";
import type { Account } from "../../../types/customer.type.js";
import type {
  SoaItem,
  StatementOfAccountModel,
} from "../../../types/soa.type.js";
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
  soaData: StatementOfAccountModel[] | null;
}

/**
 * Process a single branch: read staging, filter aging, generate docs, send email.
 * Each external call is wrapped in its own ctx.run() — no nesting.
 * Returns null on non-terminal failures (branch error isolation).
 */
async function processSingleBranch(
  params: ProcessSoaParams,
  branch: Branch
): Promise<BranchProcessResult | null> {
  const { ctx, customerData, params: soaParams } = params;

  let rawSoaList: StatementOfAccountModel[] | null;
  try {
    rawSoaList = await ctx.run<StatementOfAccountModel[] | null>(
      `read-staging-${branch.officeCode}`,
      async () => await getStagingSoaData(customerData.code, branch.officeCode)
    );
  } catch (error: unknown) {
    if (error instanceof TerminalError) {
      throw error;
    }
    ctx.console.log(
      `[Branch] Failed staging read for ${branch.officeCode}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return null;
  }

  if (!rawSoaList || rawSoaList.length === 0) {
    ctx.console.log(`[Branch] No SOA data for ${branch.officeCode}`);
    return { branch, hasDocuments: false, soaData: null };
  }

  ctx.console.log(
    `Processing branch ${branch.officeCode} for customer ${customerData.code}`
  );

  const soaData = filterAgingData(rawSoaList);
  if (!soaData) {
    ctx.console.log(`Skipping ${customerData.code}: No aging records found`);
    return { branch, hasDocuments: false, soaData: null };
  }

  const startTime = await ctx.date.now();
  const dateNow = new Date(soaParams.processingDate);

  ctx.console.log(
    `SOA generated for ${customerData.code} branch ${branch.officeCode}: ${soaData.length} records`
  );

  try {
    await ctx.run(`generate-upload-send-${branch.officeCode}`, async () => {
      const generated = await generateAndUploadDocuments({
        soaData,
        customerData,
        params: soaParams,
        branchName: branch.name,
        letterNo: "",
        latestLetter: null,
        pdfFileName: letterSoaPdfName(customerData.code),
      });

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
      `[Branch] Failed generate/send for ${branch.officeCode}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return null;
  }

  const duration = (await ctx.date.now()) - startTime;
  ctx.console.log(
    { component: "Branch", branch: branch.officeCode, durationMs: duration },
    `Branch ${branch.officeCode} completed in ${duration}ms`
  );

  return { branch, hasDocuments: true, soaData };
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

  for (const result of results) {
    if (result.hasDocuments && result.soaData) {
      await createReminder({
        customer: customerData,
        timePeriod: params.params.timePeriod,
        branchCode: result.branch.officeCode,
        processingDate: params.params.processingDate,
        soaList: result.soaData,
        ctx,
      });
    }
  }

  return { hasDocuments: results.some((r) => r.hasDocuments) };
}
