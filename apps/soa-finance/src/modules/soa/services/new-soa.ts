import type { WorkflowContext } from "@restatedev/restate-sdk";
import type { IAccount, ISoaItem } from "../../../types";
import { sendWithAttachments } from "../../email";
import { runReminderSchedule } from "../../reminder/run-schedule";
import { multiBranchCodes } from "../types";
import {
  processMultiBranchSoa,
  processSingleBranchSoa,
} from "./process-branches";

type newSoaParams = {
  ctx: WorkflowContext;
  customerData: IAccount;
  params: ISoaItem;
};

export async function newSoa(parameters: newSoaParams): Promise<void> {
  const { ctx, customerData, params } = parameters;

  const isMultiBranchCustomer = () =>
    multiBranchCodes.includes(customerData.actingCode);

  const hasDocuments = isMultiBranchCustomer()
    ? await processMultiBranchSoa({ ctx, customerData, params })
    : await processSingleBranchSoa({ ctx, customerData, params });

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

    await runReminderSchedule({ ctx, customerData, params });
  } else {
    ctx.console.log(
      `Skipping email for ${params.customerId}: no documents generated`
    );
  }
}
