import type { WorkflowContext } from "@restatedev/restate-sdk";
import { uploadFile } from "../../../infrastructure/azure";
import { getAllBranches } from "../../../infrastructure/database/queries";
import { generatePdf } from "../../../infrastructure/gotenberg/gotenberg-client";
import { createReminder, processBranch } from "../../services";
import { letterSoaPdfName } from "../../utils/formatter/naming";
import { getSignature } from "../../utils/generators";
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
          const isReminder = params.processingType > 1;
          const pdfHtml = await renderLiquidToHtml(
            isReminder
              ? "TemplateReminderLetterSOA"
              : "TemplateOutstandingStatementOfAccount",
            {
              asAtDate: params.toDate,
              customerName: customerData.fullName,
              virtualAccount: customerData.virtualAccount,
              signature: await getSignature(),
            }
          );

          const pdfBuffer = await generatePdf(pdfHtml, {
            marginTop: 0.5,
            marginBottom: 0.5,
            marginLeft: 0.5,
            marginRight: 0.5,
          });

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
