import type { ObjectContext } from "@restatedev/restate-sdk";
import { RestatePromise } from "@restatedev/restate-sdk";
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

export type ProcessSoaParams = {
  ctx: ObjectContext;
  customerData: IAccount;
  params: ISoaItem;
};

type BranchResult = {
  hasDocuments: boolean;
};

type ProcessSingleBranchParams = {
  ctx: ObjectContext;
  customerData: IAccount;
  params: ISoaItem;
  branch: IBranch;
  rawSoaList: IStatementOfAccountModel[] | null;
};

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

  // Generate, upload to S3 (archival), and send email — all in one ctx.run
  // so binary data stays inside the callback and is not journaled
  await ctx.run(
    `generate-upload-send-${branch.officeCode}`,
    { timeout: 180_000 },
    async () => {
      const files = await generateAndUploadDocuments({
        soaData,
        customerData,
        params,
        branchName: branch.name,
        letterNo: "",
        latestLetter: null,
        pdfFileName: letterSoaPdfName(customerData.code),
      });

      const dateNow = new Date(params.processingDate);
      await sendWithAttachments({
        customerData,
        date: dateNow,
        isReminder: false,
        excelFile: files.excelFile,
        pdfFile: files.pdfFile,
      });
    }
  );

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

export async function processBranchSoa({
  ctx,
  customerData,
  params,
}: ProcessSoaParams): Promise<BranchResult> {
  const isMultiBranch =
    !isDevelopment() && multiBranchCodes.includes(customerData.actingCode);

  const branches: IBranch[] = isMultiBranch
    ? await ctx.run(
        "get-branches",
        { timeout: 30_000 },
        async () => await getAllBranches()
      )
    : [{ officeCode: params.branch, name: params.branch }];

  if (isMultiBranch) {
    ctx.console.log(`Processing ${branches.length} branches`);
  } else if (multiBranchCodes.includes(customerData.actingCode)) {
    ctx.console.log(
      `[Dev] Skipping multi-branch loop for ${customerData.code}, using branch ALL`
    );
  }

  if (branches.length > 1) {
    // Multi-branch: parallel with RestatePromise.all
    const branchResults = await RestatePromise.all(
      branches.map((b) =>
        ctx
          .run<IStatementOfAccountModel[]>(
            `read-staging-${b.officeCode}`,
            { timeout: 30_000 },
            async () => await getStagingSoaData(customerData.code, b.officeCode)
          )
          .map((stagingData, failure): Promise<BranchResult> => {
            if (failure) {
              ctx.console.log(
                `[Branch] Failed staging read for ${b.officeCode}: ${failure.message}`
              );
              return Promise.resolve({ hasDocuments: false });
            }

            return processSingleBranch({
              ctx,
              customerData,
              params,
              branch: b,
              rawSoaList: stagingData as IStatementOfAccountModel[] | null,
            });
          })
      )
    );

    return { hasDocuments: branchResults.some((r) => r.hasDocuments) };
  }

  // Single-branch: direct execution (no RestatePromise.all overhead)
  const branch = branches[0];
  try {
    const rawSoaList = await ctx.run<IStatementOfAccountModel[]>(
      `read-staging-${branch.officeCode}`,
      { timeout: 30_000 },
      async () => await getStagingSoaData(customerData.code, branch.officeCode)
    );

    return processSingleBranch({
      ctx,
      customerData,
      params,
      branch,
      rawSoaList,
    });
  } catch (error) {
    ctx.console.log(
      `[Branch] Failed staging read for ${branch.officeCode}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return { hasDocuments: false };
  }
}
