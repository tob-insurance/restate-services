import type { Context } from "@restatedev/restate-sdk";
import { isDevelopment, parseEnvBool } from "../constants/environment.js";
import logger from "../utils/logger.js";
import { SoaRefreshManager } from "./refresh-manager.js";
import type { SoaPipelineResult } from "./types.js";

// Pipeline: materialize SOA query result into staging table.
// Uses incremental refresh via SoaRefreshManager Virtual Object.

export async function generateSoaPipeline(
  ctx: Context,
  _asAtDate: Date
): Promise<SoaPipelineResult> {
  logger.info({ component: "Pipeline" }, "Starting SOA pipeline");

  const forceRefresh = parseEnvBool("SOA_DEV_REFRESH_STAGING");

  if (isDevelopment() && !forceRefresh) {
    logger.info(
      { component: "Pipeline" },
      "DEV MODE: skipping staging refresh (set SOA_DEV_REFRESH_STAGING=true to force)"
    );
    return { success: true };
  }

  // Call refresh manager via Restate client
  const refreshClient = ctx.objectClient(SoaRefreshManager, "main");

  if (forceRefresh) {
    // Force full refresh
    await refreshClient.forceFullRefresh();
  } else {
    // Incremental refresh
    await refreshClient.refresh();
  }

  logger.info({ component: "Pipeline" }, "Completed");

  return { success: true };
}
