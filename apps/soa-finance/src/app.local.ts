import "varlock/auto-load";
import { serve } from "@restatedev/restate-sdk";
import {
  closeConnections,
  initPostgresClient,
  testPostgresConnection,
} from "./infrastructure/database/postgres.js";
import { sharedServices } from "./services.js";
import {
  checkGotenbergConnectivity,
  checkS3BucketAccess,
} from "./utils/health.js";
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

  // Prevent crashes from PostgreSQL TLS timeout on idle connections
  process.on("uncaughtException", (err) => {
    if (err.message?.includes("ETIMEDOUT") && err.stack?.includes("pg/")) {
      logger.warn(
        { component: "App", err: err.message },
        "PostgreSQL TLS timeout on idle connection (non-fatal)"
      );
      return;
    }
    // Re-throw other uncaught exceptions
    logger.error({ component: "App", err }, "Uncaught exception");
    process.exit(1);
  });
}

registerShutdownHandlers();

const PORT = 9080;

async function main() {
  logger.info({ component: "App" }, "Testing PostgreSQL connection...");
  initPostgresClient();

  const postgres = await testPostgresConnection();
  if (!postgres) {
    logger.error(
      { component: "App" },
      "⚠️  PostgreSQL connection failed, but server will continue..."
    );
  }

  const [s3Result, gotenbergResult] = await Promise.all([
    checkS3BucketAccess(),
    checkGotenbergConnectivity(),
  ]);
  logger.info(
    {
      component: "HealthCheck",
      postgres: !!postgres,
      s3: s3Result,
      gotenberg: gotenbergResult,
    },
    "External service health"
  );

  await serve({
    services: sharedServices,
    port: PORT,
  });

  logger.info({ component: "App", port: PORT }, "Server started");
  logger.info({ component: "App" }, "Registered services");
  for (const service of sharedServices) {
    logger.info(
      { component: "App", service: service.name },
      "Registered service"
    );
  }
}

main().catch((err) => {
  logger.error({ component: "App", err }, "Failed to start application");
  process.exit(1);
});
