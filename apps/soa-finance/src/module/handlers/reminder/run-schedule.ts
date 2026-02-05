import type { WorkflowContext } from "@restatedev/restate-sdk";

import {
  getAllBranches,
  getReminderByCustomerAndPeriod,
} from "../../../infrastructure/database/queries";
import { processReminderLetter } from "../../services";

import type { IAccount, ISoaItem, SoaType } from "../../utils/types";

interface IScheduleConfig {
  type: "SOA" | "RL1" | "RL2" | "RL3";
  soaType: SoaType;
  sendDay: number;
  dueDay?: number;
}

const SCHEDULE_CONFIG: IScheduleConfig[] = [
  { type: "SOA", soaType: 1, sendDay: 4 }, // SOA: tanggal 4
  { type: "RL1", soaType: 2, sendDay: 11, dueDay: 18 }, // RL1: tanggal 11, due 18
  { type: "RL2", soaType: 3, sendDay: 19, dueDay: 24 }, // RL2: tanggal 19, due 24
  { type: "RL3", soaType: 4, sendDay: 25, dueDay: 28 }, // RL3: tanggal 25, due 28
];

type ReminderScheduleParams = {
  ctx: WorkflowContext;
  customerData: IAccount;
  params: ISoaItem;
};

function calculateWaitUntilDay(
  targetDay: number,
  fromDate: Date = new Date()
): number {
  const now = fromDate;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDay = now.getDate();

  let targetDate: Date;

  if (currentDay > targetDay) {
    targetDate = new Date(currentYear, currentMonth, targetDay, 0, 0, 0, 0);
  } else {
    targetDate = new Date(currentYear, currentMonth + 1, targetDay, 0, 0, 0, 0);
  }

  const waitTime = targetDate.getTime() - now.getTime();
  return Math.max(0, waitTime);
}

function getDueDate(dueDay: number, referenceDate: Date = new Date()): Date {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();

  return new Date(year, month, dueDay, 0, 0, 0, 0);
}

export async function runReminderSchedule({
  ctx,
  customerData,
  params,
}: ReminderScheduleParams): Promise<number> {
  let remindersSent = 0;
  // Mulai dari RL1 (index 1), karena SOA sudah dikirim terlebih dahulu
  for (let i = 1; i < SCHEDULE_CONFIG.length; i++) {
    const schedule = SCHEDULE_CONFIG[i];

    ctx.console.log(
      `Menunggu jadwal ${schedule.type} (tanggal ${schedule.sendDay})...`
    );
    // Hitung waktu tunggu hingga tanggal pengiriman
    const waitTime = params.testMode
      ? 2 * 60 * 1000 // Test mode: 2 menit
      : calculateWaitUntilDay(schedule.sendDay);
    // Tunggu hingga tanggal pengiriman
    await ctx.sleep(waitTime);
    // Cek apakah masih ada tagihan outstanding
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
    // Siapkan data untuk pengiriman
    const dueDate = schedule.dueDay ? getDueDate(schedule.dueDay) : undefined;
    const reminderProcessingItem: ISoaItem = {
      ...params,
      processingType: schedule.soaType,
      // Tambahkan due date jika diperlukan di ISoaItem
      // dueDate: dueDate,
    };
    ctx.console.log(
      `Memproses ${schedule.type} - Due Date: ${schedule.dueDay ?? "N/A"}`
    );
    // Dapatkan data cabang
    const branchesForReminder = await ctx.run(
      `get-branches-for-${schedule.type.toLowerCase()}`,
      async () => await getAllBranches()
    );
    // Kirim reminder
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
    remindersSent++;
    ctx.console.log(`${schedule.type} berhasil dikirim`);
  }
  ctx.console.log(
    `Jadwal reminder selesai, total ${remindersSent} reminder terkirim`
  );
  return remindersSent;
}
