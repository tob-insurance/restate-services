/**
 * Process SOA for single-branch customers
 * Creates reminder for the specified branch
 */

import type { WorkflowContext } from "@restatedev/restate-sdk";

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

export async function processSingleBranchSoa({
  ctx,
  customerData,
  params,
}: ProcessSoaParams): Promise<void> {
  const singleResult = await ctx.run(
    "single-branch",
    async () => await processSingleBranch(params.branch, customerData, params)
  );

  if (singleResult.soaData && singleResult.soaData.length > 0) {
    await ctx.run(
      "create-reminder",
      async () =>
        await createReminder(
          customerData,
          params.timePeriod,
          params.branch,
          singleResult.soaData as IStatementOfAccountModel[]
        )
    );
  }
}
