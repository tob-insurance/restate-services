import type { WorkflowContext } from "@restatedev/restate-sdk";
import { SCHEDULE_CONFIG } from "../../constants/schedule";
import {
  getAllBranches,
  getReminderByCustomerAndPeriod,
} from "../../infrastructure/database/index.js";
import type { IAccount, ISoaItem } from "../../types";
import { processReminderLetter } from "./process-reminder";

type ReminderScheduleParams = {
  ctx: WorkflowContext;
  customerData: IAccount;
  params: ISoaItem;
};

import { calculateWaitUntilDay } from "../../utils/formatter";

export async function runReminderSchedule({
  ctx,
  customerData,
  params,
}: ReminderScheduleParams): Promise<number> {
  let remindersSent = 0;
  for (let i = 1; i < SCHEDULE_CONFIG.length; i++) {
    const schedule = SCHEDULE_CONFIG[i];

    const waitTime = params.testMode
      ? 2 * 60 * 1000
      : calculateWaitUntilDay(schedule.sendDay);

    const targetTimeStr = new Date(Date.now() + waitTime).toLocaleString(
      "id-ID"
    );
    ctx.console.log(
      `Menunggu jadwal ${schedule.type} (tanggal ${schedule.sendDay}). Target: ${targetTimeStr}`
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
      ctx.console.log("Semua SOA sudah dibayar, menghentikan reminder");
      break;
    }

    const reminderProcessingItem: ISoaItem = {
      ...params,
      processingType: schedule.soaType,
    };

    ctx.console.log(
      `Memproses ${schedule.type} - Due Date: ${schedule.dueDay ?? "N/A"}`
    );
    const branchesForReminder = await ctx.run(
      `get-branches-for-${schedule.type.toLowerCase()}`,
      async () => await getAllBranches()
    );
    await ctx.run(
      `send-${schedule.type.toLowerCase()}`,
      async () =>
        await processReminderLetter({
          customer: customerData,
          branches: branchesForReminder,
          item: reminderProcessingItem,
          ctx,
        })
    );
    remindersSent += 1;
    ctx.console.log(`${schedule.type} berhasil dikirim`);
  }
  ctx.console.log(
    `Jadwal reminder selesai, total ${remindersSent} reminder terkirim`
  );
  return remindersSent;
}
