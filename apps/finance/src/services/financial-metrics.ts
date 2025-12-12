import type { PoolClient, QueryResult } from "pg";
import { pool } from "../pg";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export type FinancialMetricsResult = {
  success: boolean;
  startTime: Date;
  endTime: Date;
  duration: number;
  rowsAffected?: number;
  message: string;
  runId?: string;
};

/**
 * Helper to manage PostgreSQL connection lifecycle
 */
async function withPostgresConnection<T>(
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    return await operation(client);
  } finally {
    client.release();
  }
}

/**
 * Execute PostgreSQL financial metrics calculation
 * This function calls the financial_report.calculate_financial_metrics stored function
 *
 * @param reportDate - Date in YYYY-MM-DD format
 * @returns Result object with execution details
 */
export async function calculateFinancialMetrics(
  reportDate: string
): Promise<FinancialMetricsResult> {
  const startTime = new Date();

  const date = new Date(reportDate);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  console.log(
    `🔄 Calculating financial metrics for year: ${year}, month: ${month}`
  );

  try {
    return await withPostgresConnection(async (client) => {
      await client.query("SET search_path TO financial_report");

      const runIdResult = await client.query(
        "SELECT gen_random_uuid() as run_id"
      );
      const runId = runIdResult.rows[0].run_id;

      console.log(`   Run ID: ${runId}`);

      let result: QueryResult;
      try {
        result = await client.query(
          "SELECT financial_report.calculate_financial_metrics($1::UUID, $2::INTEGER, $3::INTEGER) as result",
          [runId, year, month]
        );
      } catch (execError) {
        const pgError = execError as {
          message?: string;
          detail?: string;
          hint?: string;
          code?: string;
        };
        console.error("❌ PostgreSQL function execution failed:");
        console.error(`   Error: ${pgError.message || "Unknown error"}`);
        console.error(`   Detail: ${pgError.detail || "N/A"}`);
        console.error(`   Hint: ${pgError.hint || "N/A"}`);
        console.error(`   Run ID: ${runId}`);

        // Check if this is a data integrity issue (not retryable)
        const isDataError =
          pgError.code === "23502" || // not_null_violation
          pgError.code === "23503" || // foreign_key_violation
          pgError.code === "23505" || // unique_violation
          pgError.code === "23514"; // check_violation

        if (isDataError) {
          console.error(
            `   This is a data integrity error (code: ${pgError.code}), not retrying.`
          );

          const endTime = new Date();
          const duration = (endTime.getTime() - startTime.getTime()) / 1000;

          return {
            success: false,
            startTime,
            endTime,
            duration,
            message: `Data integrity error: ${pgError.message || "Unknown error"}. Check calculation_runs table for run_id: ${runId}`,
            runId,
          };
        }

        throw execError;
      }

      const endTime = new Date();
      const duration = (endTime.getTime() - startTime.getTime()) / 1000;
      const resultMessage = result.rows[0]?.result || "Completed";

      console.log(
        `✅ Financial metrics calculation completed in ${duration} seconds`
      );
      console.log(`   Result: ${resultMessage}`);

      return {
        success: true,
        startTime,
        endTime,
        duration,
        rowsAffected: result.rowCount || 0,
        message: resultMessage,
        runId,
      };
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Financial metrics calculation failed:", errorMessage);
    throw error;
  }
}

/**
 * Get calculation run status from PostgreSQL
 * Useful for checking detailed error information
 */
export async function getCalculationRunStatus(runId: string): Promise<{
  status: string;
  completedSteps: number;
  totalSteps: number;
  errorCount: number;
  warningCount: number;
  metadata: Record<string, unknown>;
} | null> {
  try {
    return await withPostgresConnection(async (client) => {
      const result = await client.query(
        `SELECT status, completed_steps, total_steps, error_count, warning_count, metadata
         FROM financial_report.calculation_runs
         WHERE id = $1`,
        [runId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        status: row.status,
        completedSteps: row.completed_steps,
        totalSteps: row.total_steps,
        errorCount: row.error_count,
        warningCount: row.warning_count,
        metadata: row.metadata,
      };
    });
  } catch (error) {
    console.error("Failed to get calculation run status:", error);
    return null;
  }
}

/**
 * Validate date format (YYYY-MM-DD)
 */
export function validateDateFormat(date: string): boolean {
  if (!DATE_REGEX.test(date)) {
    return false;
  }

  const parsedDate = new Date(date);
  return !Number.isNaN(parsedDate.getTime());
}
