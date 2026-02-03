/**
 * Process SOA for a single branch
 */

import type { WorkflowContext } from "@restatedev/restate-sdk";
import type {
  IAccount,
  ISoaItem,
  IStatementOfAccountModel,
} from "../../utils/types";
import { generateSoa } from "./generate";

export const processBranch = async (
  ctx: WorkflowContext | undefined,
  branchCode: string,
  customer: IAccount,
  item: ISoaItem
): Promise<{
  processed: boolean;
  recordCount: number;
  soaData?: IStatementOfAccountModel[];
}> => {
  const dateNow = new Date(item.processingDate);

  console.log(`Processing branch ${branchCode} for customer ${customer.code}`);

  const result = await generateSoa({
    ctx,
    branchCode,
    customer,
    classOfBusiness: item.classOfBusiness,
    processingType: item.processingType,
    dateNow,
    toDate: item.toDate,
    jobId: item.jobId || "",
    testMode: item.testMode ?? false,
    skipAgingFilter: item.skipAgingFilter ?? false,
    skipDcNoteCheck: item.skipDcNoteCheck ?? false,
  });

  if (result && result.length > 0) {
    console.log(
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
