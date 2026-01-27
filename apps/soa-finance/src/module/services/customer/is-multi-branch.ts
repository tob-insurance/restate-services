/**
 * Check if customer is multi-branch
 */

import { multiBranchCodes } from "../../utils/types/soa";

export const isMultiBranchCustomer = (actingCode: string): boolean =>
  multiBranchCodes.includes(actingCode);
