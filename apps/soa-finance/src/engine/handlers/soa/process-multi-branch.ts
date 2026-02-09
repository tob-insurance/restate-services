import type { WorkflowContext } from "@restatedev/restate-sdk";
import { uploadFile } from "../../../infrastructure/azure";
import {
  getAllBranches,
  getLatestLetter,
} from "../../../infrastructure/database/index.js";
import { generatePdfWithHeaderFooter } from "../../../infrastructure/gotenberg/gotenberg-client";
import { createReminder, processBranch } from "../../../modules";
import type {
  IAccount,
  ISoaItem,
  IStatementOfAccountModel,
} from "../../../types";
import { createFooter, createHeader } from "../../../utils/email";
import {
  formatDateEnglish,
  formatDateIndonesian,
  formatMonthEnglish,
  formatMonthIndonesian,
  formatThousands,
  letterSoaPdfName,
} from "../../../utils/formatter";
import {
  generateLetterNumber,
  getFooter,
  getHeader,
  getSignature,
  renderLiquidToHtml,
} from "../../../utils/generators";

export type ProcessSoaParams = {
  ctx: WorkflowContext;
  customerData: IAccount;
  params: ISoaItem;
};

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
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complex logic
        async () => {
          const isReminder = params.processingType > 1;
          const toDate = new Date(params.toDate * 1000);

          let templateData: Record<string, unknown> = {};

          if (isReminder) {
            const reminderCount = (params.processingType - 1).toString();
            const totalPremiumVal = (branchResult.soaData || []).reduce(
              (acc: number, item: IStatementOfAccountModel) =>
                acc + (item.netPremiumIdr || 0),
              0
            );

            let letterNoReff: string | null = null;
            let sentDateId: string | null = null;
            let sentDateEn: string | null = null;

            if (params.processingType > 2) {
              const latestLetter = await getLatestLetter(params.jobId);
              if (latestLetter) {
                letterNoReff = latestLetter.letterNo;
                sentDateId = formatDateIndonesian(latestLetter.sentDate);
                sentDateEn = formatDateEnglish(latestLetter.sentDate);
              }
            }

            templateData = {
              AsAtDateId: formatDateIndonesian(toDate),
              AsAtDateEn: formatDateEnglish(toDate),
              LetterNo: await generateLetterNumber(reminderCount, toDate),
              Name: customerData.fullName,
              Branch: branchItem.name,
              ReminderCount: reminderCount,
              TotalPremium: formatThousands(totalPremiumVal),
              OutstandingMonthId: formatMonthIndonesian(toDate),
              OutstandingMonthEn: formatMonthEnglish(toDate),
              LetterNoReff: letterNoReff,
              SentDateId: sentDateId,
              SentDateEn: sentDateEn,
              VirtualNumber: customerData.virtualAccount,
              ImgSign: await getSignature(),
            };
          } else {
            templateData = {
              asAtDate: formatDateIndonesian(toDate),
              customerName: customerData.fullName,
              virtualAccount: customerData.virtualAccount,
              signature: await getSignature(),
            };
          }

          const bodyHtml = await renderLiquidToHtml(
            isReminder
              ? "TemplateReminderLetterSOA"
              : "TemplateOutstandingStatementOfAccount",
            templateData
          );

          const headerHtml = createHeader(getHeader());
          const footerHtml = createFooter(getFooter());

          const pdfBuffer = await generatePdfWithHeaderFooter(
            bodyHtml,
            headerHtml,
            footerHtml
          );

          const pdfFileName = letterSoaPdfName(customerData.code);

          await uploadFile(
            {
              fileName: pdfFileName,
              bytes: pdfBuffer,
              contentType: "application/pdf",
            },
            customerData.code,
            "pdf"
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
