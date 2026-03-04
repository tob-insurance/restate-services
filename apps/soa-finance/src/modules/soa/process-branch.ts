import type { WorkflowContext } from "@restatedev/restate-sdk";

import type { IAccount, ISoaItem, IStatementOfAccountModel } from "../../types";
import { generateSoa } from "./generate";

export const processBranch = async (
  ctx: WorkflowContext,
  branchCode: string,
  customer: IAccount,
  item: ISoaItem
): Promise<{
  processed: boolean;
  recordCount: number;
  soaData?: IStatementOfAccountModel[];
}> => {
  const dateNow = new Date(item.processingDate);

  ctx.console.log(
    `Processing branch ${branchCode} for customer ${customer.code}`
  );

  const result = await generateSoa({
    ctx,
    branchCode,
    customer,
    classOfBusiness: item.classOfBusiness,
    processingType: item.processingType,
    dateNow,
    skipAgingFilter: item.skipAgingFilter ?? false,
    skipDcNoteCheck: item.skipDcNoteCheck ?? false,
  });

  if (result && result.length > 0) {
    ctx.console.log(
      `SOA generated for ${customer.code} branch ${branchCode}: ${result.length} records`
    );

    return {
      processed: true,
      recordCount: result.length,
      soaData: result,
    };
  }

  return {
    processed: result !== null,
    recordCount: result?.length ?? 0,
  };
};
