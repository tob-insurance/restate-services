/**
 * Process SOA for a single branch
 */

import type {
  IAccount,
  ISoaItem,
  IStatementOfAccountModel,
} from "../../utils/types";
import { generateSoa } from "./generate";

export const processSingleBranch = async (
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
    branchCode,
    customer,
    classOfBusiness: item.classOfBusiness,
    dateNow,
    toDate: item.toDate,
    jobId: item.jobId || "",
    testMode: item.testMode ?? false,
    skipAgingFilter: item.skipAgingFilter ?? false,
    skipDcNoteCheck: item.skipDcNoteCheck ?? false,
  });

  // Return SOA data for reminder creation in separate checkpoint
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
