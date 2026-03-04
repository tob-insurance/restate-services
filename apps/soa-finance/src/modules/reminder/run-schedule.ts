import type { WorkflowContext } from "@restatedev/restate-sdk";
import { SCHEDULE_CONFIG } from "../../constants/schedule";
import { getReminderByCustomerAndPeriod } from "../../infrastructure/database/index.js";
import type { IAccount, ISoaItem } from "../../types";
import { processReminderLetter } from "./process-reminder";

type ReminderScheduleParams = {
  ctx: WorkflowContext;
  customerData: IAccount;
  params: ISoaItem;
};

import { isDevelopment } from "../../constants/environment";
import { calculateWaitUntilDay } from "../../utils/formatter";

const DEV_SCHEDULE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

export async function runReminderSchedule({
  ctx,
  customerData,
  params,
}: ReminderScheduleParams): Promise<number> {
  let remindersSent = 0;
  for (let i = 1; i < SCHEDULE_CONFIG.length; i++) {
    const schedule = SCHEDULE_CONFIG[i];

    const waitTime = isDevelopment()
      ? DEV_SCHEDULE_INTERVAL_MS
      : calculateWaitUntilDay(schedule.sendDay);

    const now = await ctx.date.now();
    const targetTimeStr = new Date(now + waitTime).toLocaleString("id-ID");
    ctx.console.log(
      `Waiting for schedule ${schedule.type} (day ${schedule.sendDay}). Target: ${targetTimeStr}`
    );
    await ctx.sleep(waitTime);
    const outstandingReminders = await ctx.run(
      `check-payment-${schedule.type.toLowerCase()}`,
      async () =>
        await getReminderByCustomerAndPeriod(
          customerData.code,
          params.timePeriod
        )
    );
    if (!outstandingReminders || outstandingReminders.length === 0) {
      ctx.console.log("All SOAs have been paid, stopping reminder");
      break;
    }

    const reminderProcessingItem: ISoaItem = {
      ...params,
      processingType: schedule.soaType,
    };

    ctx.console.log(
      `Processing ${schedule.type} - Due Date: ${schedule.dueDay ?? "N/A"}`
    );
    await processReminderLetter({
      customer: customerData,
      item: reminderProcessingItem,
    });
    remindersSent += 1;
    ctx.console.log(`${schedule.type} successfully sent`);
  }
  ctx.console.log(
    `Reminder schedule complete, total ${remindersSent} reminders sent`
  );
  return remindersSent;
}
