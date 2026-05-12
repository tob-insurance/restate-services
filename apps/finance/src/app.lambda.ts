import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { initGeniusClient } from "./infrastructure/database.js";
import {
  DailyClosingScheduler,
  dailyClosingWorkflow,
} from "./modules/closing/index.js";

initGeniusClient();

export const handler = createEndpointHandler({
  services: [dailyClosingWorkflow, DailyClosingScheduler],
});
