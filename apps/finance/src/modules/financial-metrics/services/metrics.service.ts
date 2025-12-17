import { isDataIntegrityError, withConnection } from "@restate-tob/postgres";
import { DateTime } from "luxon";
import type { QueryResult } from "pg";
import { getPostgresClient } from "../../../infrastructure/database.js";
import type { CalculationRunStatus, FinancialMetricsResult } from "../types.js";

export async function calculateFinancialMetrics(
  reportDate: string
): Promise<FinancialMetricsResult> {
  const startTime = DateTime.now();

  const date = DateTime.fromISO(reportDate);
  const year = date.year;
  const month = date.month;

  console.log(
    `🔄 Calculating financial metrics for year: ${year}, month: ${month}`
  );

  try {
    return await withConnection(getPostgresClient(), async (client) => {
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

        if (isDataIntegrityError(pgError.code)) {
          console.error(
            `   This is a data integrity error (code: ${pgError.code}), not retrying.`
          );

          const endTime = DateTime.now();
          const duration = endTime.diff(startTime, "seconds").seconds;

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

      const endTime = DateTime.now();
      const duration = endTime.diff(startTime, "seconds").seconds;
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

export async function getCalculationRunStatus(
  runId: string
): Promise<CalculationRunStatus | null> {
  try {
    return await withConnection(getPostgresClient(), async (client) => {
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
