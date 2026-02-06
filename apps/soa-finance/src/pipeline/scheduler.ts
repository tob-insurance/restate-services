import { SCHEDULE_CONFIG } from "../constants/schedule";
import { calculateWaitUntilDay } from "../utils/formatter";
import { generateSoaPipeline } from "./index";

export async function pipelineScheduler() {
  console.log("Pipeline Scheduler Started");

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
      `Next Pipeline Run (${nextRun.type}): ${targetDate.toLocaleString()}`
    );

    await sleep(nextRun.waitTime);

    console.log(`Executing Pipeline for schedule: ${nextRun.type}`);
    try {
      await generateSoaPipeline(new Date(), false);
      console.log(`Pipeline ${nextRun.type} completed successfully`);
    } catch (error) {
      console.error(`Pipeline ${nextRun.type} failed:`, error);
    }

    await sleep(5000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
