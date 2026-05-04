import type { ObjectContext } from "@restatedev/restate-sdk";
import { isDevelopment } from "../../../constants";
import { getAllBranches } from "../../../infrastructure/database/index.js";
import type {
  IAccount,
  ISoaItem,
  IStatementOfAccountModel,
} from "../../../types";
import { letterSoaPdfName } from "../../../utils/formatter";
import { generateAndUploadDocuments } from "../../document-generation";
import { createReminder } from "../../reminder";
import { generateSoa } from "../generate";
import { multiBranchCodes } from "../types";

export type ProcessSoaParams = {
  ctx: ObjectContext;
  customerData: IAccount;
  params: ISoaItem;
};

type BranchInfo = { officeCode: string; name: string };

async function getSoaLetterSequence(ctx: ObjectContext): Promise<number> {
  const count = (await ctx.get<number>("soaLetterCount")) ?? 0;
  ctx.set("soaLetterCount", count + 1);
  return count + 1;
}

async function getLetterNo(
  ctx: ObjectContext,
  processingType: number,
  toDateTimestamp: number
): Promise<string> {
  const isReminder = processingType > 1;
  if (!isReminder) {
    return "";
  }

  const reminderCount = (processingType - 1).toString();
  const dateNow = new Date(toDateTimestamp * 1000);
  const seqNo = await getSoaLetterSequence(ctx);
  const padded = seqNo.toString().padStart(3, "0");
  const roman = [
    "I",
    "II",
    "III",
    "IV",
    "V",
    "VI",
    "VII",
    "VIII",
    "IX",
    "X",
    "XI",
    "XII",
  ];
  const month = roman[dateNow.getMonth()];
  const year = dateNow.getFullYear();

  return `${padded}/FIN/SOA/RL${reminderCount}/${month}/${year}`;
}

// biome-ignore lint/nursery/useMaxParams: pre-existing signature
async function generateSoaDocuments(
  soaData: IStatementOfAccountModel[],
  customerData: IAccount,
  params: ISoaItem,
  branchName: string,
  letterNo: string
): Promise<void> {
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
  const isMultiBranch =
    !isDevelopment() && multiBranchCodes.includes(customerData.actingCode);

  const branches: BranchInfo[] = isMultiBranch
    ? await ctx.run("get-branches", async () => await getAllBranches())
    : [{ officeCode: params.branch, name: params.branch }];

  if (isMultiBranch) {
    ctx.console.log(`Processing ${branches.length} branches`);
  } else if (multiBranchCodes.includes(customerData.actingCode)) {
    ctx.console.log(
      `[Dev] Skipping multi-branch loop for ${customerData.code}, using branch ALL`
    );
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
      const letterNo = await getLetterNo(
        ctx,
        params.processingType,
        params.toDate
      );

      await ctx.run(stepName, async () => {
        await generateSoaDocuments(
          soaData,
          customerData,
          params,
          branch.name,
          letterNo
        );
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
