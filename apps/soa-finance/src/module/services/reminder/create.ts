/**
 * Create reminder record in database
 */

import {
  insertReminder,
  insertReminderDetail,
} from "../../../infrastructure/database/queries";
import type { IAccount, IStatementOfAccountModel } from "../../utils/types";

export const createReminder = async (
  customer: IAccount,
  timePeriod: string,
  branchCode: string,
  soaList: IStatementOfAccountModel[]
): Promise<string> => {
  console.log(
    `Creating SOA reminder for ${customer.code}, branch: ${branchCode}`
  );

  // Insert reminder and get ID
  const reminderId = await insertReminder(
    customer.code,
    timePeriod,
    branchCode
  );

  // Insert details for each SOA item
  for (const soa of soaList) {
    await insertReminderDetail(soa.debitAndCreditNoteNo, reminderId, "N");
  }

  console.log(
    `Created reminder ${reminderId} with ${soaList.length} details for ${customer.code}`
  );

  return reminderId;
};
