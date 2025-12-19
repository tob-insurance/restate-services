import "varlock/auto-load";
import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { initOracleClient } from "./infrastructure/database.js";
import {
  DailyClosingScheduler,
  dailyClosingWorkflow,
} from "./modules/closing/index.js";

initOracleClient();

export const handler = createEndpointHandler({
  services: [dailyClosingWorkflow, DailyClosingScheduler],
});
