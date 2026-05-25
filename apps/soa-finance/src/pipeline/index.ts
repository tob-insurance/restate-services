import { isDevelopment } from "../constants/environment.js";
import logger from "../utils/logger.js";
import { refreshStaging } from "./read/staging.js";
import type { SoaPipelineResult } from "./types.js";

// Pipeline: materialize SOA query result into staging table.
// The SOA workflow reads from the staging table directly — no Parquet intermediary.

export async function generateSoaPipeline(
  asAtDate: Date
): Promise<SoaPipelineResult> {
  logger.info({ component: "Pipeline" }, "Starting SOA pipeline");

  if (isDevelopment()) {
    logger.info(
      { component: "Pipeline" },
      "DEV MODE: skipping staging refresh"
    );
    return { success: true };
  }

  await refreshStaging(asAtDate);

  logger.info({ component: "Pipeline" }, "Completed");

  return { success: true };
}
