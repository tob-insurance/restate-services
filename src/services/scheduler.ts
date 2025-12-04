import * as restate from "@restatedev/restate-sdk";
import { dailyClosingWorkflow } from "../workflows/dailyClosing";

const SCHEDULE_CONFIG = {
    hour: 14,
    minute: 33,
};

export const DailyClosingScheduler = restate.object({
    name: "DailyClosingScheduler",
    handlers: {
        /**
         * Start the scheduler.
         * This should be called once to kick off the cycle.
         */
        start: async (ctx: restate.ObjectContext) => {
            ctx.console.log("🚀 Starting DailyClosingScheduler");
            await scheduleNextRun(ctx);
        },

        /**
         * Trigger the workflow and schedule the next run.
         * This is called automatically by the delayed send.
         */
        trigger: async (ctx: restate.ObjectContext) => {
            const now = new Date();
            // const dateStr = now.toISOString().split('T')[0];
            // Static date for testing
            const dateStr = "2025-11-30";

            ctx.console.log(`⏰ Triggering Daily Closing Workflow for date: ${dateStr}`);


            (ctx.objectSendClient(dailyClosingWorkflow, dateStr) as any).run({
                date: dateStr,
                userId: 'ASK'
            });

            await scheduleNextRun(ctx);
        }
    }
});

async function scheduleNextRun(ctx: restate.ObjectContext) {
    const currentTime = await ctx.date.now();
    const nowObj = new Date(currentTime);

    ctx.console.log(`[DEBUG] Current Time (UTC): ${nowObj.toISOString()}`);

    const jakartaOffset = 7 * 60 * 60 * 1000;
    const jakartaTime = new Date(nowObj.getTime() + jakartaOffset);

    ctx.console.log(`[DEBUG] Current Time (Jakarta Shifted): ${jakartaTime.toISOString().replace('Z', '')}`);

    const nextRunJakarta = new Date(jakartaTime);
    // Set the target hour directly on the Jakarta-shifted time
    nextRunJakarta.setUTCHours(SCHEDULE_CONFIG.hour, SCHEDULE_CONFIG.minute, 0, 0);

    ctx.console.log(`[DEBUG] Target Time (Jakarta Shifted, Before Check): ${nextRunJakarta.toISOString().replace('Z', '')}`);

    if (nextRunJakarta.getTime() <= jakartaTime.getTime()) {
        ctx.console.log(`[DEBUG] Target time has passed today. Scheduling for tomorrow.`);
        nextRunJakarta.setUTCDate(nextRunJakarta.getUTCDate() + 1);
    } else {
        ctx.console.log(`[DEBUG] Target time is in the future today.`);
    }

    // Calculate delay
    // (TargetShifted - NowShifted) is the same as (TargetReal - NowReal)
    const delayMs = nextRunJakarta.getTime() - jakartaTime.getTime();

    // For logging, we show the Jakarta time (remove 'Z' to avoid confusion, or explicit label)
    const nextRunJakartaStr = nextRunJakarta.toISOString().replace('Z', ' (Jakarta Time)');

    ctx.console.log(`📅 Next run scheduled for: ${nextRunJakartaStr} (in ${Math.round(delayMs / 1000 / 60)} minutes)`);

    // Send delayed message to 'trigger' handler
    ctx.objectSendClient(DailyClosingScheduler, "main", { delay: delayMs }).trigger();
}
