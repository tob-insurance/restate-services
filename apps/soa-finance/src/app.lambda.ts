import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { initPostgresClient } from "./infrastructure/database/postgres.js";
import { sharedServices } from "./services.js";
import logger from "./utils/logger.js";

// Catch unhandled rejections
process.on("unhandledRejection", (reason) => {
  logger.error({ component: "FATAL", err: reason }, "Unhandled Rejection");
});

process.on("uncaughtException", (error) => {
  // Suppress PostgreSQL TLS timeout on idle connections
  if (error.message?.includes("ETIMEDOUT") && error.stack?.includes("pg/")) {
    logger.warn(
      { component: "App", err: error.message },
      "PostgreSQL TLS timeout on idle connection (non-fatal)"
    );
    return;
  }
  logger.error({ component: "FATAL", err: error }, "Uncaught Exception");
});

initPostgresClient();

export const handler = createEndpointHandler({
  services: sharedServices,
});
