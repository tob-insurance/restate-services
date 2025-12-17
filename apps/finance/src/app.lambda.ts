import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { getOracleClient } from "./infrastructure/database.js";
import {
  DailyClosingScheduler,
  dailyClosingWorkflow,
} from "./modules/closing/index.js";

getOracleClient();

export const handler = createEndpointHandler({
  services: [dailyClosingWorkflow, DailyClosingScheduler],
});
