import type { WorkflowContext } from "@restatedev/restate-sdk";

import { isMultiBranchCustomer, sendWithAttachments } from "../../services";
import type { IAccount, ISoaItem } from "../../utils/types";
import { runReminderSchedule } from "../reminder/run-schedule";
import { processMultiBranchSoa } from "./process-multi-branch";
import { processSingleBranchSoa } from "./process-single-branch";

type newSoaParams = {
  ctx: WorkflowContext;
  customerData: IAccount;
  params: ISoaItem;
  jobId: string;
};

export async function newSoa(parameters: newSoaParams): Promise<void> {
  const { ctx, customerData, params, jobId } = parameters;

  if (isMultiBranchCustomer(customerData.actingCode)) {
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
