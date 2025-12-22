import { withConnection } from "@restate-tob/oracle";
import { parseDateParts } from "@restate-tob/shared";
import { TerminalError } from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import { OUT_FORMAT_OBJECT } from "oracledb";
import { z } from "zod";
import {
  DateStringSchema,
  getOracleClient,
  JobNameSchema,
  UserIdSchema,
} from "../../../infrastructure/index.js";
import type { GeniusClosingJobSubmit, GeniusJobStatus } from "../types.js";

const SubmitJobInputSchema = z.object({
  closingDate: DateStringSchema,
  userId: UserIdSchema,
  currentTimeMillis: z.number().optional(),
});

export async function submitGeniusClosingJob(
  closingDate: string,
  userId = "adm",
  currentTimeMillis?: number
): Promise<GeniusClosingJobSubmit> {
  const validated = SubmitJobInputSchema.parse({
    closingDate,
    userId,
    currentTimeMillis,
  });

  const startTime = validated.currentTimeMillis
    ? DateTime.fromMillis(validated.currentTimeMillis)
    : DateTime.now();

  try {
    const { year, month } = parseDateParts(validated.closingDate);
    const shortYear = String(year).slice(-2);
    const uniqueSuffix = startTime.toMillis().toString(36).toUpperCase();
    const jobName = `GNS_${shortYear}${month}_${uniqueSuffix}`;

    console.log(`🚀 Submitting Genius closing job: ${jobName}`);
    console.log(
      `   Year: ${year}, Month: ${month}, UserId: ${validated.userId}`
    );

    await withConnection(getOracleClient(), async (connection) => {
      const escapeOracleString = (value: string): string =>
        value.replace(/'/g, "''");

      const safeYear = escapeOracleString(String(year));
      const safeMonth = escapeOracleString(String(month));
      const safeUserId = escapeOracleString(validated.userId);

      const plsqlBlock = `DECLARE
  l_out_1 VARCHAR2(4000);
  l_out_2 VARCHAR2(4000);
BEGIN
  Package_Rpt_Ac_Fi806.get_master_data('${safeYear}', '${safeMonth}', '${safeMonth}', '${safeUserId}', l_out_1, l_out_2);
END;`;

      await connection.execute(
        `BEGIN
           DBMS_SCHEDULER.CREATE_JOB (
             job_name   => :jobName,
             job_type   => 'PLSQL_BLOCK',
             job_action => :jobAction,
             enabled    => TRUE
           );
         END;`,
        {
          jobName,
          jobAction: plsqlBlock,
        },
        { autoCommit: true }
      );
    });

    console.log(
      `✅ Job ${jobName} submitted successfully (running in background)`
    );
    console.log(
      `   Use checkGeniusClosingJobStatus('${jobName}') to check progress`
    );

    return {
      submitted: true,
      jobName,
      message:
        "Job submitted successfully. It will run in background for up to 6 hours.",
      startTime,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new TerminalError(
        `Validation error: ${error.issues.map((e: z.ZodIssue) => e.message).join(", ")}`,
        { errorCode: 400 }
      );
    }
    throw error;
  }
}

export async function checkGeniusClosingJobStatus(
  jobName: string
): Promise<GeniusJobStatus> {
  try {
    const validated = JobNameSchema.parse(jobName);

    return await withConnection(getOracleClient(), async (connection) => {
      const result = await connection.execute(
        `SELECT state, failure_count,
                TO_CHAR(last_start_date, 'YYYY-MM-DD HH24:MI:SS') as last_start,
                TO_CHAR(last_run_duration, 'HH24:MI:SS') as duration
         FROM user_scheduler_jobs
         WHERE job_name = :jobName`,
        { jobName: validated },
        { outFormat: OUT_FORMAT_OBJECT }
      );

      if (!result.rows || result.rows.length === 0) {
        return {
          status: "NOT_FOUND",
          running: false,
          completed: true,
          failed: false,
          message: `Job ${validated} not found. It likely completed successfully and was cleaned up by the scheduler.`,
        };
      }

      const row = result.rows[0] as {
        STATE: string;
        FAILURE_COUNT: number;
        LAST_START: string;
        DURATION: string;
      };
      const state = row.STATE;
      const failureCount = row.FAILURE_COUNT;
      const lastStart = row.LAST_START;
      const duration = row.DURATION;

      const running = state === "RUNNING";
      const completed = state === "SUCCEEDED" || state === "COMPLETED";
      const failed = state === "FAILED" || failureCount > 0;

      let message = `Job ${validated}: ${state}`;
      if (lastStart) {
        message += ` (started: ${lastStart})`;
      }
      if (duration) {
        message += ` (duration: ${duration})`;
      }
      if (failureCount) {
        message += ` [Failures: ${failureCount}]`;
      }

      return {
        status: state,
        running,
        completed,
        failed,
        message,
      };
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new TerminalError(`Invalid job name: ${jobName}`, {
        errorCode: 400,
      });
    }
    throw error;
  }
}
