import type { ObjectContext } from "@restatedev/restate-sdk";
import { RestatePromise, TerminalError } from "@restatedev/restate-sdk";
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
import { generateAndUploadDocuments } from "../../document-generation";
import { sendWithAttachments } from "../../email";
import { createReminder } from "../../reminder";
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
  hasDocuments: boolean;
  soaData: StatementOfAccountModel[] | null;
}

interface ProcessSingleBranchParams {
  branch: Branch;
  ctx: ObjectContext;
  customerData: Account;
  params: SoaItem;
  rawSoaList: StatementOfAccountModel[] | null;
}

async function processSingleBranch({
  ctx,
  customerData,
  params,
  branch,
  rawSoaList,
}: ProcessSingleBranchParams): Promise<BranchProcessResult> {
  if (!rawSoaList || rawSoaList.length === 0) {
    ctx.console.log(`[Branch] No SOA data for ${branch.officeCode}`);
    return { hasDocuments: false, soaData: null };
  }

  ctx.console.log(
    `Processing branch ${branch.officeCode} for customer ${customerData.code}`
  );

  const soaData = filterAgingData(rawSoaList);
  if (!soaData) {
    ctx.console.log(`Skipping ${customerData.code}: No aging records found`);
    return { hasDocuments: false, soaData: null };
  }

  const startTime = await ctx.date.now();

  ctx.console.log(
    `SOA generated for ${customerData.code} branch ${branch.officeCode}: ${soaData.length} records`
  );

  const dateNow = new Date(params.processingDate);

  await ctx.run(`generate-upload-send-${branch.officeCode}`, async () => {
    const generated = await generateAndUploadDocuments({
      soaData,
      customerData,
      params,
      branchName: branch.name,
      letterNo: "",
      latestLetter: null,
      pdfFileName: letterSoaPdfName(customerData.code),
    });

    await sendWithAttachments({
      customerData,
      date: dateNow,
      isReminder: false,
      excelFile: generated.excelFile,
      pdfFile: generated.pdfFile,
    });
  });

  const duration = (await ctx.date.now()) - startTime;
  ctx.console.log(
    { component: "Branch", branch: branch.officeCode, durationMs: duration },
    `Branch ${branch.officeCode} completed in ${duration}ms`
  );

  return { hasDocuments: true, soaData };
}

async function processMultiBranchSoa(
  branches: Branch[],
  soaParams: ProcessSoaParams
): Promise<BranchResult> {
  const { ctx, customerData, params } = soaParams;

  const stagingDataList = await RestatePromise.all(
    branches.map((b) =>
      ctx.run<StatementOfAccountModel[] | null>(
        `read-staging-${b.officeCode}`,
        async () => await getStagingSoaData(customerData.code, b.officeCode)
      )
    )
  );

  const docPromises = branches.map((b, index) =>
    ctx
      .run(`process-branch-${b.officeCode}`, () =>
        processSingleBranch({
          ctx,
          customerData,
          params,
          branch: b,
          rawSoaList: stagingDataList[index],
        })
      )
      .map((_value, failure: unknown): BranchProcessResult => {
        if (failure) {
          if (failure instanceof TerminalError) {
            throw failure;
          }
          ctx.console.log(
            `[Branch] Failed ${b.officeCode}: ${failure instanceof Error ? failure.message : "Unknown error"}`
          );
          return { hasDocuments: false, soaData: null };
        }
        return _value ?? { hasDocuments: false, soaData: null };
      })
  );

  const docResults = await RestatePromise.all(docPromises);

  for (const [index, result] of docResults.entries()) {
    if (result.hasDocuments && result.soaData) {
      await createReminder({
        customer: customerData,
        timePeriod: params.timePeriod,
        branchCode: branches[index].officeCode,
        processingDate: params.processingDate,
        soaList: result.soaData,
        ctx,
      });
    }
  }

  return { hasDocuments: docResults.some((r) => r.hasDocuments) };
}

async function processSingleBranchDirect(
  branch: Branch,
  soaParams: ProcessSoaParams
): Promise<BranchResult> {
  const { ctx, customerData, params } = soaParams;
  try {
    const rawSoaList = await ctx.run<StatementOfAccountModel[]>(
      "read-staging",
      async () => await getStagingSoaData(customerData.code, branch.officeCode)
    );

    const result = await processSingleBranch({
      ctx,
      customerData,
      params,
      branch,
      rawSoaList,
    });

    if (result.hasDocuments && result.soaData) {
      await createReminder({
        customer: customerData,
        timePeriod: params.timePeriod,
        branchCode: branch.officeCode,
        processingDate: params.processingDate,
        soaList: result.soaData,
        ctx,
      });
    }

    return { hasDocuments: result.hasDocuments };
  } catch (error: unknown) {
    if (error instanceof TerminalError) {
      throw error;
    }
    ctx.console.log(
      `[Branch] Failed staging read for ${branch.officeCode}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return { hasDocuments: false };
  }
}

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

  if (branches.length > 1) {
    return processMultiBranchSoa(branches, params);
  }

  return processSingleBranchDirect(branches[0], params);
}
