import {
  DailyClosingScheduler,
  dailyClosingWorkflow,
} from "./modules/closing/index.js";

export const sharedServices = [dailyClosingWorkflow, DailyClosingScheduler];
