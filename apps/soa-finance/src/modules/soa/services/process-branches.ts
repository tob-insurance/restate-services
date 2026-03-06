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
import { generateSoa } from "../generate";
import { multiBranchCodes } from "../types";

export type ProcessSoaParams = {
  ctx: WorkflowContext;
  customerData: IAccount;
  params: ISoaItem;
};

type BranchInfo = { officeCode: string; name: string };

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

export async function processBranchSoa({
  ctx,
  customerData,
  params,
}: ProcessSoaParams): Promise<boolean> {
  const isMultiBranch = multiBranchCodes.includes(customerData.actingCode);

  const branches: BranchInfo[] = isMultiBranch
    ? await ctx.run("get-branches", async () => await getAllBranches())
    : [{ officeCode: params.branch, name: params.branch }];

  if (isMultiBranch) {
    ctx.console.log(`Processing ${branches.length} branches`);
  }

  let hasDocuments = false;

  for (const branch of branches) {
    const dateNow = new Date(params.processingDate);

    ctx.console.log(
      `Processing branch ${branch.officeCode} for customer ${customerData.code}`
    );

    const soaData = await generateSoa({
      ctx,
      branchCode: branch.officeCode,
      customer: customerData,
      classOfBusiness: params.classOfBusiness,
      processingType: params.processingType,
      dateNow,
    });

    if (soaData && soaData.length > 0) {
      ctx.console.log(
        `SOA generated for ${customerData.code} branch ${branch.officeCode}: ${soaData.length} records`
      );

      const stepName = isMultiBranch
        ? `generate-and-upload-pdf-${branch.officeCode}`
        : "generate-and-upload-pdf";

      await ctx.run(stepName, async () => {
        await generateSoaDocuments(soaData, customerData, params, branch.name);
      });

      await createReminder({
        customer: customerData,
        timePeriod: params.timePeriod,
        branchCode: branch.officeCode,
        soaList: soaData,
        ctx,
      });

      hasDocuments = true;
    }
  }

  return hasDocuments;
}
