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

  await ctx.run(
    "send-email",
    async () =>
      await sendWithAttachments({
        customerId: params.customerId,
        customerData,
        testMode: params.testMode,
        jobId,
        date: dateNow,
      })
  );

  await runReminderSchedule({ ctx, customerData, params });
}
