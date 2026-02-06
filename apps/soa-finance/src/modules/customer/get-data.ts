import {
  completeJobPhase,
  getAccountById,
  insertJobPhase,
} from "../../database";
import { type IAccount, SoaPhase } from "../../types";

export const getCustomerData = async (
  jobId: string,
  customerId: string
): Promise<IAccount | null> => {
  await insertJobPhase(jobId, SoaPhase.RetrievingCustomerData);
  const customer = await getAccountById(customerId);
  await completeJobPhase(jobId, SoaPhase.RetrievingCustomerData);

  return customer;
};
