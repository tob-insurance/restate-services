import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { batchWorkflow, soaWorkflow } from "./engine/index.js";
import { initOracleClient } from "./infrastructure/database/database.js";

initOracleClient();

export const handler = createEndpointHandler({
  services: [soaWorkflow, batchWorkflow],
});
