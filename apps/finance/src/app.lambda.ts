import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { initPostgresClient } from "./infrastructure/database.js";
import { sharedServices } from "./services.js";
import logger from "./utils/logger.js";

process.on("unhandledRejection", (reason) => {
  logger.error({ component: "FATAL", err: reason }, "Unhandled Rejection");
});

process.on("uncaughtException", (error) => {
  logger.error({ component: "FATAL", err: error }, "Uncaught Exception");
});

try {
  initPostgresClient();
} catch (error) {
  logger.warn(
    { component: "INIT", err: error },
    "PostgreSQL pool init deferred — will retry on first query"
  );
}

export const handler = createEndpointHandler({
  services: sharedServices,
});
