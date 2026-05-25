import { isDataIntegrityError, withConnection } from "@restate-tob/postgres";
import { DateStringSchema, UuidSchema } from "@restate-tob/shared";
import { TerminalError } from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import type { QueryResult } from "pg";
import { z } from "zod";
import { getPostgresClient } from "../../../infrastructure/index.js";
import type { CalculationRunStatus, FinancialMetricsResult } from "../types.js";

const CalculateMetricsInputSchema = z.object({
  reportDate: DateStringSchema,
  runId: UuidSchema,
  currentTimeMillis: z.number(),
});

const CalculationRunStatusRowSchema = z.object({
  status: z.string(),
  completed_steps: z.number(),
  total_steps: z.number(),
  error_count: z.number(),
  warning_count: z.number(),
  metadata: z.any().optional(),
});

export async function calculateFinancialMetrics(
  reportDate: string,
  runId: string,
  currentTimeMillis: number
): Promise<FinancialMetricsResult> {
  const validated = CalculateMetricsInputSchema.parse({
    reportDate,
    runId,
    currentTimeMillis,
  });

  const startTime = DateTime.fromMillis(validated.currentTimeMillis);

  const date = DateTime.fromISO(validated.reportDate);
  const year = date.year;
  const month = date.month;

  try {
    return await withConnection(getPostgresClient(), async (client) => {
      let result: QueryResult;
      try {
        result = await client.query(
          "SELECT financial_report.calculate_financial_metrics($1::UUID, $2::INTEGER, $3::INTEGER) as result",
          [validated.runId, year, month]
        );
      } catch (execError: unknown) {
        const pgError = execError as {
          message?: string;
          detail?: string;
          hint?: string;
          code?: string;
        };

        if (isDataIntegrityError(pgError.code)) {
          throw new TerminalError(
            `Data integrity error: ${
              pgError.message || "Unknown error"
            }. Check calculation_runs table for run_id: ${validated.runId}`,
            { errorCode: 422 }
          );
        }

        throw execError;
      }

      const endTime = DateTime.fromMillis(validated.currentTimeMillis);
      const duration = endTime.diff(startTime, "seconds").seconds;
      const resultMessage = result.rows[0]?.result || "Completed";

      return {
        success: true,
        startTime,
        endTime,
        duration,
        rowsAffected: result.rowCount || 0,
        message: resultMessage,
        runId: validated.runId,
      };
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      throw new TerminalError(
        `Validation error: ${error.issues
          .map((e: z.ZodIssue) => e.message)
          .join(", ")}`,
        { errorCode: 400 }
      );
    }
    throw error;
  }
}

export async function getCalculationRunStatus(
  runId: string
): Promise<CalculationRunStatus | null> {
  const validated = UuidSchema.parse(runId);

  return await withConnection(getPostgresClient(), async (client) => {
    const result = await client.query(
      `SELECT status, completed_steps, total_steps, error_count, warning_count, metadata
       FROM financial_report.calculation_runs
       WHERE id = $1`,
      [validated]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = CalculationRunStatusRowSchema.parse(result.rows[0]);
    return {
      status: row.status,
      completedSteps: row.completed_steps,
      totalSteps: row.total_steps,
      errorCount: row.error_count,
      warningCount: row.warning_count,
      metadata: row.metadata,
    };
  });
}
