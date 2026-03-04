import { SCHEDULE_CONFIG } from "../constants/schedule";
import { calculateWaitUntilDay } from "../utils/formatter";
import { generateSoaPipeline } from "./index";

export async function pipelineScheduler() {
  console.log("[Scheduler] Pipeline scheduler started");

  while (true) {
    const targetHour = 5;
    const targetMinute = 0;

    const scheduleRuns = SCHEDULE_CONFIG.map((s) => ({
      type: s.type,
      day: s.sendDay,
      waitTime: calculateWaitUntilDay(s.sendDay, targetHour, targetMinute),
    }));

    scheduleRuns.sort((a, b) => a.waitTime - b.waitTime);
    const nextRun = scheduleRuns[0];

    const targetDate = new Date(Date.now() + nextRun.waitTime);
    console.log(
      `[Scheduler] Next run (${nextRun.type}): ${targetDate.toLocaleString()}`
    );

    await sleep(nextRun.waitTime);

    console.log(`[Scheduler] Executing pipeline for: ${nextRun.type}`);
    try {
      await generateSoaPipeline(new Date());
      console.log(`[Scheduler] Pipeline ${nextRun.type} completed`);
    } catch (error) {
      console.error(`[Scheduler] Pipeline ${nextRun.type} failed:`, error);
    }

    await sleep(5000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
