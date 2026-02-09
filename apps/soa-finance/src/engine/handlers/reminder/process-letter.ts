import type { WorkflowContext } from "@restatedev/restate-sdk";

import { getAllBranches } from "../../../infrastructure/database/index.js";
import { processReminderLetter } from "../../../modules";
import type { IAccount, ISoaItem } from "../../../types";

type ProcessReminderParams = {
  ctx: WorkflowContext;
  customerData: IAccount;
  params: ISoaItem;
};

export async function processReminder(
  parameters: ProcessReminderParams
): Promise<void> {
  const { ctx, customerData, params } = parameters;

  const branchesForReminder = await ctx.run(
    "get-branches-for-reminder",
    async () => await getAllBranches()
  );

  await processReminderLetter({
    customer: customerData,
    branches: branchesForReminder,
    item: params,
    ctx,
  });
}
