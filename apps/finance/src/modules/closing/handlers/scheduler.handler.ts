import { type ObjectContext, object } from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import { dailyClosingWorkflow } from "../workflows/index.js";

const SCHEDULE_CONFIG = {
  hour: 0,
  minute: 0,
};

const JAKARTA_ZONE = "Asia/Jakarta";

export const DailyClosingScheduler = object({
  name: "DailyClosingScheduler",
  handlers: {
    start: async (ctx: ObjectContext) => {
      ctx.console.log("🚀 Starting DailyClosingScheduler");
      await scheduleNextRun(ctx);
    },

    trigger: async (ctx: ObjectContext) => {
      const nowJakarta = DateTime.now().setZone(JAKARTA_ZONE);
      const dateStr = nowJakarta.toFormat("yyyy-MM-dd");

      ctx.console.log(
        `⏰ Triggering Daily Closing Workflow for date: ${dateStr}`
      );

      ctx.workflowSendClient(dailyClosingWorkflow, dateStr).run({
        date: dateStr,
        skipOracleClosing: false,
        skipFinancialMetrics: false,
        userId: "adm",
      });

      await scheduleNextRun(ctx);
    },
  },
});

async function scheduleNextRun(ctx: ObjectContext) {
  const currentTime = await ctx.date.now();
  const nowJakarta = DateTime.fromMillis(currentTime).setZone(JAKARTA_ZONE);

  ctx.console.log(
    `[DEBUG] Current Time (UTC): ${DateTime.fromMillis(currentTime).toISO()}`
  );
  ctx.console.log(
    `[DEBUG] Current Jakarta Time: ${nowJakarta.toFormat("yyyy-MM-dd HH:mm")}`
  );

  let targetTime = nowJakarta.set({
    hour: SCHEDULE_CONFIG.hour,
    minute: SCHEDULE_CONFIG.minute,
    second: 0,
    millisecond: 0,
  });

  if (targetTime <= nowJakarta) {
    targetTime = targetTime.plus({ days: 1 });
  }

  const delayMs = targetTime.diff(nowJakarta, "milliseconds").milliseconds;
  const targetTimeStr = `${targetTime.toFormat("yyyy-MM-dd HH:mm")} (Jakarta Time)`;

  ctx.console.log(
    `📅 Next run scheduled for: ${targetTimeStr} (in ${Math.round(delayMs / 1000 / 60)} minutes)`
  );

  ctx
    .objectSendClient(DailyClosingScheduler, "main", { delay: delayMs })
    .trigger();
}
