import "dotenv/config";
import { serve } from "@restatedev/restate-sdk";
import { closeConnections, testConnection } from "./infrastructure/database.js";
import { sharedServices } from "./services.js";
import logger from "./utils/logger.js";

function registerShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    logger.info(
      { component: "App", signal },
      "Shutdown signal received, closing connections..."
    );
    await closeConnections();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

registerShutdownHandlers();

testConnection().then((postgres) => {
  if (!postgres) {
    logger.error(
      { component: "App" },
      "⚠️  PostgreSQL connection failed, but server will continue..."
    );
  }

  serve({
    services: sharedServices,
    port: 9080,
  });

  logger.info({ component: "App", port: 9080 }, "Server started");
  logger.info({ component: "App" }, "Registered services");
  for (const service of sharedServices) {
    logger.info(
      { component: "App", service: service.name },
      "Registered service"
    );
  }
});
