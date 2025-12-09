import * as restate from "@restatedev/restate-sdk";
import { dailyClosingWorkflow } from "../workflows/dailyClosing";

const SCHEDULE_CONFIG = {
    hour: 10,
    minute: 24
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

            // Calculate Jakarta date for the workflow ID (UTC+7)
            const jakartaTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
            const dateStr = jakartaTime.toISOString().split('T')[0];

            ctx.console.log(`⏰ Triggering Daily Closing Workflow for date: ${dateStr}`);

            (ctx.objectSendClient(dailyClosingWorkflow, dateStr) as any).run({
                date: dateStr,
                userId: 'ASK'
            });

            // IMPORTANT: Await the rescheduling to ensure it persists
            await scheduleNextRun(ctx);
        }
    }
});

async function scheduleNextRun(ctx: restate.ObjectContext) {
    const currentTime = await ctx.date.now();
    const nowUTC = new Date(currentTime);

    ctx.console.log(`[DEBUG] Current Time (UTC): ${nowUTC.toISOString()}`);

    // Jakarta is UTC+7
    const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

    // Get current Jakarta time by shifting
    const jakartaNowMs = nowUTC.getTime() + JAKARTA_OFFSET_MS;
    const jakartaNow = new Date(jakartaNowMs);

    // Extract Jakarta date components (using getUTC* because the Date is shifted)
    const jakartaYear = jakartaNow.getUTCFullYear();
    const jakartaMonth = jakartaNow.getUTCMonth();
    const jakartaDay = jakartaNow.getUTCDate();
    const jakartaHour = jakartaNow.getUTCHours();
    const jakartaMinute = jakartaNow.getUTCMinutes();

    ctx.console.log(`[DEBUG] Current Jakarta Time: ${jakartaYear}-${String(jakartaMonth + 1).padStart(2, '0')}-${String(jakartaDay).padStart(2, '0')} ${String(jakartaHour).padStart(2, '0')}:${String(jakartaMinute).padStart(2, '0')}`);

    // Build target time for TODAY in Jakarta (as shifted UTC)
    let targetJakartaMs = Date.UTC(
        jakartaYear,
        jakartaMonth,
        jakartaDay,
        SCHEDULE_CONFIG.hour,
        SCHEDULE_CONFIG.minute,
        0,
        0
    );

    ctx.console.log(`[DEBUG] Target Jakarta Time (today): ${new Date(targetJakartaMs).toISOString().replace('Z', '')} (config: ${SCHEDULE_CONFIG.hour}:${String(SCHEDULE_CONFIG.minute).padStart(2, '0')})`);

    // If target time has passed today in Jakarta, schedule for tomorrow
    if (targetJakartaMs <= jakartaNowMs) {
        ctx.console.log(`[DEBUG] Target time has passed today. Scheduling for tomorrow.`);
        targetJakartaMs += 24 * 60 * 60 * 1000; // Add 1 day
    } else {
        ctx.console.log(`[DEBUG] Target time is in the future today.`);
    }

    // Calculate delay (same in any timezone representation)
    const delayMs = targetJakartaMs - jakartaNowMs;

    // For logging - show the target Jakarta time
    const targetJakarta = new Date(targetJakartaMs);
    const targetStr = `${targetJakarta.getUTCFullYear()}-${String(targetJakarta.getUTCMonth() + 1).padStart(2, '0')}-${String(targetJakarta.getUTCDate()).padStart(2, '0')} ${String(targetJakarta.getUTCHours()).padStart(2, '0')}:${String(targetJakarta.getUTCMinutes()).padStart(2, '0')} (Jakarta Time)`;

    ctx.console.log(`📅 Next run scheduled for: ${targetStr} (in ${Math.round(delayMs / 1000 / 60)} minutes)`);

    // Send delayed message to 'trigger' handler
    ctx.objectSendClient(DailyClosingScheduler, "main", { delay: delayMs }).trigger();
}
