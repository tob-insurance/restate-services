import type { WorkflowContext } from "@restatedev/restate-sdk";
import { getAllBranches } from "../../../infrastructure/database/index.js";
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

  const letterNo = isReminder
    ? await generateLetterNumber(reminderCount, toDate)
    : "";

  await generateAndUploadDocuments({
    soaData,
    customerData,
    params,
    branchName,
    letterNo,
    latestLetter: null,
    pdfFileName: letterSoaPdfName(customerData.code),
  });
}

export async function processSingleBranchSoa({
  ctx,
  customerData,
  params,
}: ProcessSoaParams): Promise<boolean> {
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

    return true;
  }

  return false;
}

export async function processMultiBranchSoa({
  ctx,
  customerData,
  params,
}: ProcessSoaParams): Promise<boolean> {
  const branches = await ctx.run(
    "get-branches",
    async () => await getAllBranches()
  );

  ctx.console.log(`Processing ${branches.length} branches`);

  let hasDocuments = false;

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

      hasDocuments = true;
    }
  }

  return hasDocuments;
}
