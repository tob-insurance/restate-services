import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import "./oracle";
import { DailyClosingScheduler } from "./services/scheduler";
import { dailyClosingWorkflow } from "./workflows/daily-closing";

export const handler = createEndpointHandler({
  services: [dailyClosingWorkflow, DailyClosingScheduler],
});
