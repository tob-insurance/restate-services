import { getReminderByCustomerAndPeriod } from "../../infrastructure/database/queries";
import {
  type IAccount,
  type IProcessReminder,
  type ISoaItem,
  type ISoaReminder,
  SoaType,
} from "../utils/types";
import { generateReminderLetter } from "./generate-reminder-letter";

type ProcessReminderLetterParams = {
  customer: IAccount;
  item: ISoaItem;
};

export const processReminderLetter = async (
  params: ProcessReminderLetterParams
): Promise<IProcessReminder> => {
  const { customer, item } = params;

  console.log(
    `Starting reminder letter processing for ${customer.code}, Type: ${
      SoaType[item.processingType]
    }`
  );

  // Get existing reminders from database
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

  // Loop through each reminder
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
