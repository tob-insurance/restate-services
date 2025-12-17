import {
  calculateDelayToJakartaTime,
  formatJakartaDateTime,
  getJakartaDateString,
} from "@restate-tob/shared";
import { type ObjectContext, object } from "@restatedev/restate-sdk";
import { dailyClosingWorkflow } from "../workflows/index.js";

const SCHEDULE_CONFIG = {
  hour: 0,
  minute: 0,
};

export const DailyClosingScheduler = object({
  name: "DailyClosingScheduler",
  handlers: {
    start: async (ctx: ObjectContext) => {
      ctx.console.log("🚀 Starting DailyClosingScheduler");
      await scheduleNextRun(ctx);
    },

    trigger: async (ctx: ObjectContext) => {
      const now = new Date();
      const dateStr = getJakartaDateString(now);

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
  const nowUTC = new Date(currentTime);

  ctx.console.log(`[DEBUG] Current Time (UTC): ${nowUTC.toISOString()}`);
  ctx.console.log(
    `[DEBUG] Current Jakarta Time: ${formatJakartaDateTime(nowUTC)}`
  );

  const { delayMs, targetTimeStr } = calculateDelayToJakartaTime(
    currentTime,
    SCHEDULE_CONFIG.hour,
    SCHEDULE_CONFIG.minute
  );

  ctx.console.log(
    `📅 Next run scheduled for: ${targetTimeStr} (in ${Math.round(delayMs / 1000 / 60)} minutes)`
  );

  ctx
    .objectSendClient(DailyClosingScheduler, "main", { delay: delayMs })
    .trigger();
}
