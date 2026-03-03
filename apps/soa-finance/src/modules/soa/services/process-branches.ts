import type { WorkflowContext } from "@restatedev/restate-sdk";
import {
  getAllBranches,
  getLatestLetter,
} from "../../../infrastructure/database/index.js";
import type {
  IAccount,
  ISoaItem,
  IStatementOfAccountModel,
} from "../../../types";
import { letterSoaPdfName } from "../../../utils/formatter";
import {
  generateAndUploadDocuments,
  generateLetterNumber,
} from "../../document-generation";
import { createReminder } from "../../reminder";
import { processBranch } from "../process-branch";

export type ProcessSoaParams = {
  ctx: WorkflowContext;
  customerData: IAccount;
  params: ISoaItem;
};

async function generateSoaDocuments(
  soaData: IStatementOfAccountModel[],
  customerData: IAccount,
  params: ISoaItem,
  branchName: string
): Promise<void> {
  const isReminder = params.processingType > 1;
  const toDate = new Date(params.toDate * 1000);
  const reminderCount = (params.processingType - 1).toString();

  let latestLetter: { letterNo: string; sentDate: Date } | null = null;
  if (params.processingType > 2) {
    latestLetter = await getLatestLetter(params.jobId);
  }

  const letterNo = isReminder
    ? await generateLetterNumber(reminderCount, toDate)
    : "";

  await generateAndUploadDocuments({
    soaData,
    customerData,
    params,
    branchName,
    letterNo,
    latestLetter,
    pdfFileName: letterSoaPdfName(customerData.code),
  });
}

export async function processSingleBranchSoa({
  ctx,
  customerData,
  params,
}: ProcessSoaParams): Promise<void> {
  const singleResult = await processBranch(
    ctx,
    params.branch,
    customerData,
    params
  );

  if (singleResult.soaData && singleResult.soaData.length > 0) {
    await ctx.run("generate-and-upload-pdf", async () => {
      await generateSoaDocuments(
        singleResult.soaData as IStatementOfAccountModel[],
        customerData,
        params,
        params.branch
      );
    });

    await createReminder({
      customer: customerData,
      timePeriod: params.timePeriod,
      branchCode: params.branch,
      soaList: singleResult.soaData as IStatementOfAccountModel[],
      ctx,
    });
  }
}

export async function processMultiBranchSoa({
  ctx,
  customerData,
  params,
}: ProcessSoaParams): Promise<void> {
  const branches = await ctx.run(
    "get-branches",
    async () => await getAllBranches()
  );

  ctx.console.log(`Processing ${branches.length} branches`);

  for (const branchItem of branches) {
    const branchResult = await processBranch(
      ctx,
      branchItem.officeCode,
      customerData,
      params
    );

    if (branchResult.soaData && branchResult.soaData.length > 0) {
      await ctx.run(
        `generate-and-upload-pdf-${branchItem.officeCode}`,
        async () => {
          await generateSoaDocuments(
            branchResult.soaData as IStatementOfAccountModel[],
            customerData,
            params,
            branchItem.name
          );
        }
      );

      await createReminder({
        customer: customerData,
        timePeriod: params.timePeriod,
        branchCode: branchItem.officeCode,
        soaList: branchResult.soaData as IStatementOfAccountModel[],
        ctx,
      });
    }
  }
}
