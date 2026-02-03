import type { WorkflowContext } from "@restatedev/restate-sdk";
import { uploadFile } from "../../../infrastructure/azure";
import { generatePdfWithHeaderFooter } from "../../../infrastructure/gotenberg/gotenberg-client";
import { createReminder, processBranch } from "../../services";
import { formatDateIndonesian } from "../../utils/formatter";
import { letterSoaPdfName } from "../../utils/formatter/naming";
import { getSignature } from "../../utils/generators";
import { generateHeaderFooter } from "../../utils/generators/pdf/header-footer";
import { renderLiquidToHtml } from "../../utils/generators/pdf/render-template";
import type {
  IAccount,
  ISoaItem,
  IStatementOfAccountModel,
} from "../../utils/types";

export type ProcessSoaParams = {
  ctx: WorkflowContext;
  customerData: IAccount;
  params: ISoaItem;
};

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
      const isReminder = params.processingType > 1;
      const pdfFile = await renderLiquidToHtml(
        isReminder
          ? "TemplateReminderLetterSOA"
          : "TemplateOutstandingStatementOfAccount",
        {
          asAtDate: formatDateIndonesian(new Date(params.toDate * 1000)),
          customerName: customerData.fullName,
          virtualAccount: customerData.virtualAccount,
          signature: await getSignature(),
        }
      );

      // Generate header and footer HTML
      const { headerHtml, footerHtml } = await generateHeaderFooter();

      const pdfBuffer = await generatePdfWithHeaderFooter(
        pdfFile,
        headerHtml,
        footerHtml,
        {
          marginLeft: 0.5,
          marginRight: 0.5,
        }
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
