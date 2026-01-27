/**
 * Get customer data from database
 */

import {
  completeJobPhase,
  getAccountById,
  insertJobPhase,
} from "../../../infrastructure/database/queries";
import { type IAccount, SoaPhase } from "../../utils/types";

export const getCustomerData = async (
  jobId: string,
  customerId: string
): Promise<IAccount | null> => {
  await insertJobPhase(jobId, SoaPhase.RetrievingCustomerData);
  const customer = await getAccountById(customerId);
  await completeJobPhase(jobId, SoaPhase.RetrievingCustomerData);

  return customer;
};
