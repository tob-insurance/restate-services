import type { WorkflowContext } from "@restatedev/restate-sdk";
import type { IAccount, ISoaItem } from "../../../types";
import { SoaPhase } from "../../../types";
import { sendWithAttachments } from "../../email";
import { trackPhase } from "../../job";
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
  jobId: string;
};

export async function newSoa(parameters: newSoaParams): Promise<void> {
  const { ctx, customerData, params, jobId } = parameters;

  const isMultiBranchCustomer = () =>
    multiBranchCodes.includes(customerData.actingCode);

  if (isMultiBranchCustomer()) {
    await processMultiBranchSoa({ ctx, customerData, params });
  } else {
    await processSingleBranchSoa({ ctx, customerData, params });
  }

  const dateNow = new Date(params.processingDate);

  await trackPhase(ctx, jobId, SoaPhase.SendingEmail, async () => {
    await ctx.run(
      "send-email",
      async () =>
        await sendWithAttachments({
          customerId: params.customerId,
          customerData,
          date: dateNow,
        })
    );
  });

  await runReminderSchedule({ ctx, customerData, params });
}
