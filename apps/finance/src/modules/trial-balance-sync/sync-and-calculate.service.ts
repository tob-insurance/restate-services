import { DateTime } from "luxon";
import {
  type SyncTrialBalanceResult,
  syncTrialBalanceFromGenius,
} from "./sync.service.js";

/**
 * Syncs trial balance from Genius PostgreSQL to financial report PostgreSQL.
 * This is the primary function called by the daily closing workflow.
 *
 * Flow: Genius Closing (PostgreSQL) => Sync Trial Balance (Genius PG -> Financial Report PG) => Calculate Financial Metrics (PostgreSQL)
 *
 * @param reportDate - The report date in ISO format (YYYY-MM-DD)
 * @param currentTimeMillis - Optional current time in milliseconds for deterministic replay
 */
export async function syncTrialBalanceFromGeniusAndCalculateMetrics(
  reportDate: string,
  currentTimeMillis?: number
): Promise<SyncTrialBalanceResult> {
  const startTime = currentTimeMillis
    ? DateTime.fromMillis(currentTimeMillis)
    : DateTime.now();

  const date = DateTime.fromISO(reportDate);
  const year = date.year;
  const month = date.month;

  console.log(
    `🔄 Starting trial balance sync for ${year}-${month
      .toString()
      .padStart(2, "0")}`
  );

  try {
    const syncResult = await syncTrialBalanceFromGenius(year, month);

    if (!syncResult.success) {
      throw new Error(`Trial balance sync failed: ${syncResult.message}`);
    }

    const endTime = DateTime.now();
    const duration = endTime.diff(startTime, "seconds").seconds;

    console.log(
      `✅ Trial balance sync completed successfully in ${duration}s. Records processed: ${syncResult.recordsProcessed}`
    );

    return {
      success: true,
      recordsProcessed: syncResult.recordsProcessed,
      message: `Successfully synchronized ${syncResult.recordsProcessed} trial balance records from Genius to PostgreSQL`,
      startTime: syncResult.startTime,
      endTime: syncResult.endTime,
      duration: syncResult.duration,
    };
  } catch (error: unknown) {
    const endTime = DateTime.now();
    const duration = endTime.diff(startTime, "seconds").seconds;

    console.error("❌ Trial balance sync failed:", error);

    return {
      success: false,
      recordsProcessed: 0,
      message:
        error instanceof Error ? error.message : "Unknown error occurred",
      startTime: startTime.toJSDate(),
      endTime: endTime.toJSDate(),
      duration,
    };
  }
}
