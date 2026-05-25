import type { ObjectContext } from "@restatedev/restate-sdk";
import { RestatePromise, TerminalError } from "@restatedev/restate-sdk";
import { isDevelopment } from "../../../constants/environment.js";
import { getAllBranches } from "../../../infrastructure/database/queries/branch-query.js";
import type { IBranch } from "../../../infrastructure/database/types.js";
import type { IAccount } from "../../../types/customer.type.js";
import type {
  ISoaItem,
  IStatementOfAccountModel,
} from "../../../types/soa.type.js";
import { letterSoaPdfName } from "../../../utils/formatter/naming.formatter.js";
import { getStagingSoaData } from "../../data-access/staging-reader";
import { generateAndUploadDocuments } from "../../document-generation";
import { sendWithAttachments } from "../../email";
import { createReminder } from "../../reminder";
import { filterAgingData } from "../fetch-soa-data";
import { multiBranchCodes } from "../types";

export interface ProcessSoaParams {
  ctx: ObjectContext;
  customerData: IAccount;
  params: ISoaItem;
}

interface BranchResult {
  hasDocuments: boolean;
}

interface ProcessSingleBranchParams {
  branch: IBranch;
  ctx: ObjectContext;
  customerData: IAccount;
  params: ISoaItem;
  rawSoaList: IStatementOfAccountModel[] | null;
}

async function processSingleBranch({
  ctx,
  customerData,
  params,
  branch,
  rawSoaList,
}: ProcessSingleBranchParams): Promise<BranchResult> {
  if (!rawSoaList || rawSoaList.length === 0) {
    ctx.console.log(`[Branch] No SOA data for ${branch.officeCode}`);
    return { hasDocuments: false };
  }

  ctx.console.log(
    `Processing branch ${branch.officeCode} for customer ${customerData.code}`
  );

  const soaData = filterAgingData(rawSoaList);
  if (!soaData) {
    ctx.console.log(`Skipping ${customerData.code}: No aging records found`);
    return { hasDocuments: false };
  }

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

  await createReminder({
    customer: customerData,
    timePeriod: params.timePeriod,
    branchCode: branch.officeCode,
    processingDate: params.processingDate,
    soaList: soaData,
    ctx,
  });

  return { hasDocuments: true };
}

async function processBranchWithIsolation(
  branch: IBranch,
  index: number,
  stagingDataList: (IStatementOfAccountModel[] | null)[],
  soaParams: ProcessSoaParams
): Promise<BranchResult> {
  const { ctx, customerData, params } = soaParams;
  try {
    return await processSingleBranch({
      ctx,
      customerData,
      params,
      branch,
      rawSoaList: stagingDataList[index],
    });
  } catch (error: unknown) {
    if (error instanceof TerminalError) {
      throw error;
    }
    ctx.console.log(
      `[Branch] Failed processing ${branch.officeCode}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return { hasDocuments: false };
  }
}

async function processMultiBranchSoa(
  branches: IBranch[],
  soaParams: ProcessSoaParams
): Promise<BranchResult> {
  const { ctx, customerData } = soaParams;

  const stagingDataList = await RestatePromise.all(
    branches.map((b) =>
      ctx.run<IStatementOfAccountModel[] | null>(
        `read-staging-${b.officeCode}`,
        async () => await getStagingSoaData(customerData.code, b.officeCode)
      )
    )
  );

  const branchResults: BranchResult[] = [];
  for (const [index, b] of branches.entries()) {
    const result = await processBranchWithIsolation(
      b,
      index,
      stagingDataList,
      soaParams
    );
    branchResults.push(result);
  }

  return { hasDocuments: branchResults.some((r) => r.hasDocuments) };
}

async function processSingleBranchDirect(
  branch: IBranch,
  soaParams: ProcessSoaParams
): Promise<BranchResult> {
  const { ctx, customerData, params } = soaParams;
  try {
    const rawSoaList = await ctx.run<IStatementOfAccountModel[]>(
      "read-staging",
      async () => await getStagingSoaData(customerData.code, branch.officeCode)
    );

    return await processSingleBranch({
      ctx,
      customerData,
      params,
      branch,
      rawSoaList,
    });
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

  const branches: IBranch[] = isMultiBranch
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
