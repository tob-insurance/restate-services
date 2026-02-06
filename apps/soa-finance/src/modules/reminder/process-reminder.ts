import type { WorkflowContext } from "@restatedev/restate-sdk";

import { getReminderByCustomerAndPeriod } from "../../database";
import {
  type IAccount,
  type IBranch,
  type IProcessReminder,
  type ISoaItem,
  type ISoaReminder,
  SoaType,
} from "../../types";
import { generateReminderLetter } from "./generate-reminder-letter";

type ProcessReminderParams = {
  customer: IAccount;
  branches: IBranch[];
  item: ISoaItem;
  ctx: WorkflowContext;
};

export const processReminderLetter = async (
  params: ProcessReminderParams
): Promise<IProcessReminder> => {
  const { customer, item } = params;

  console.log(
    `Starting reminder letter processing for ${customer.code}, Type: ${
      SoaType[item.processingType]
    }`
  );

  const reminders = (await getReminderByCustomerAndPeriod(
    customer.code,
    item.timePeriod
  )) as ISoaReminder[];

  if (!reminders || reminders.length === 0) {
    console.log(`Skipping ${customer.code}: No previous reminder records`);
    return { processed: false, remindersSent: 0, dcNotesPaid: [] };
  }

  const allDcNotesPaid: string[] = [];
  let remindersSent = 0;

  for (const reminder of reminders) {
    const result = await generateReminderLetter({
      customer,
      reminder,
      item,
    });

    if (result) {
      if (result.sent) {
        remindersSent += 1;
      }
      if (result.dcNotesPaid?.length > 0) {
        allDcNotesPaid.push(...result.dcNotesPaid);
      }
    }
  }

  return { processed: true, remindersSent, dcNotesPaid: allDcNotesPaid };
};
