import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { initPostgresClient } from "./infrastructure/database.js";
import {
  DailyClosingScheduler,
  dailyClosingWorkflow,
} from "./modules/closing/index.js";

initPostgresClient();

export const handler = createEndpointHandler({
  services: [dailyClosingWorkflow, DailyClosingScheduler],
});
