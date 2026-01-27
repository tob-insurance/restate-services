/**
 * Process reminder letter
 * Initiates reminder letter processing for all branches
 */

import type { WorkflowContext } from "@restatedev/restate-sdk";

import { getAllBranches } from "../../../infrastructure/database/queries";
import { processReminderLetter } from "../../services";

import type { IAccount, ISoaItem } from "../../utils/types";

export async function processReminder(
  ctx: WorkflowContext,
  customerData: IAccount,
  params: ISoaItem
): Promise<void> {
  const branchesForReminder = await ctx.run(
    "get-branches-for-reminder",
    async () => await getAllBranches()
  );

  await ctx.run(
    "process-reminder",
    async () =>
      await processReminderLetter({
        customer: customerData,
        branches: branchesForReminder,
        item: params,
      })
  );
}
