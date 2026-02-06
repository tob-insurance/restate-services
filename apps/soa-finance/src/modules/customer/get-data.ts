import { type IAccount, SoaPhase } from "../../types";
import {
  completeJobPhase,
  getAccountById,
  insertJobPhase,
} from "../../database";

export const getCustomerData = async (
  jobId: string,
  customerId: string,
): Promise<IAccount | null> => {
  await insertJobPhase(jobId, SoaPhase.RetrievingCustomerData);
  const customer = await getAccountById(customerId);
  await completeJobPhase(jobId, SoaPhase.RetrievingCustomerData);

  return customer;
};
