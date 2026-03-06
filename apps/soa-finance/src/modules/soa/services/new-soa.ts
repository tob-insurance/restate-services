import type { WorkflowContext } from "@restatedev/restate-sdk";
import type { IAccount, ISoaItem } from "../../../types";
import { sendWithAttachments } from "../../email";
import { processBranchSoa } from "./process-branches";

type newSoaParams = {
  ctx: WorkflowContext;
  customerData: IAccount;
  params: ISoaItem;
};

export async function newSoa(parameters: newSoaParams): Promise<void> {
  const { ctx, customerData, params } = parameters;

  const hasDocuments = await processBranchSoa({ ctx, customerData, params });

  if (hasDocuments) {
    const dateNow = new Date(params.processingDate);

    await ctx.run(
      "send-email",
      async () =>
        await sendWithAttachments({
          customerId: params.customerId,
          customerData,
          date: dateNow,
        })
    );
  } else {
    ctx.console.log(
      `Skipping email for ${params.customerId}: no documents generated`
    );
  }
}
