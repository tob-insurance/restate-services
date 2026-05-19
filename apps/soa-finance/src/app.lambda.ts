import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { initOracleClient } from "./infrastructure/database/database.js";
import { sharedServices } from "./services.js";

// Catch unhandled rejections
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught Exception:", error);
});

initOracleClient();

export const handler = createEndpointHandler({
  services: sharedServices,
});
