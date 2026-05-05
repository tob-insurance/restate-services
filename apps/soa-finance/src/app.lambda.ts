import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { initOracleClient } from "./infrastructure/database/database.js";
import { sharedServices } from "./services.js";

initOracleClient();

export const handler = createEndpointHandler({
  services: sharedServices,
});
