/**
 * Process SOA for multi-branch customers
 * Iterates through all branches and creates reminders for each
 */

import type { WorkflowContext } from "@restatedev/restate-sdk";

import { getAllBranches } from "../../../infrastructure/database/queries";
import { createReminder, processSingleBranch } from "../../services";

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
    const branchResult = await ctx.run(
      `Branch-${branchItem.officeCode}`,
      async () =>
        await processSingleBranch(branchItem.officeCode, customerData, params)
    );

    if (branchResult.soaData && branchResult.soaData.length > 0) {
      await ctx.run(
        `create-reminder-${branchItem.officeCode}`,
        async () =>
          await createReminder(
            customerData,
            params.timePeriod,
            branchItem.officeCode,
            branchResult.soaData as IStatementOfAccountModel[]
          )
      );
    }
  }
}
