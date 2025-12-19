import { withConnection } from "@restate-tob/oracle";
import { parseDateParts, validateDateFormat } from "@restate-tob/shared";
import { DateTime } from "luxon";
import { OUT_FORMAT_OBJECT } from "oracledb";
import { getOracleClient } from "../../../infrastructure/database.js";
import type { GeniusClosingJobSubmit, GeniusJobStatus } from "../types.js";

export async function submitGeniusClosingJob(
  closingDate: string,
  userId = "adm"
): Promise<GeniusClosingJobSubmit> {
  const startTime = DateTime.now();

  try {
    if (!validateDateFormat(closingDate)) {
      throw new Error(
        `Invalid date format: "${closingDate}". Expected format: YYYY-MM-DD`
      );
    }

    const { year, month } = parseDateParts(closingDate);
    const shortYear = String(year).slice(-2);
    const uniqueSuffix = startTime.toMillis().toString(36).toUpperCase();
    const jobName = `GNS_${shortYear}${month}_${uniqueSuffix}`;

    console.log(`🚀 Submitting Genius closing job: ${jobName}`);
    console.log(`   Year: ${year}, Month: ${month}, UserId: ${userId}`);

    await withConnection(getOracleClient(), async (connection) => {
      await connection.execute(
        `BEGIN
           DBMS_SCHEDULER.CREATE_JOB (
             job_name   => '${jobName}',
             job_type   => 'PLSQL_BLOCK',
             job_action => 'DECLARE
               l_out_1 VARCHAR2(4000);
               l_out_2 VARCHAR2(4000);
             BEGIN
               Package_Rpt_Ac_Fi806.get_master_data(''${year}'', ''${month}'', ''${month}'', ''${userId}'', l_out_1, l_out_2);
             END;',
             enabled    => TRUE
           );
         END;`,
        {},
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
    console.error("❌ Failed to submit Genius closing job:", error);
    throw error;
  }
}

export async function checkGeniusClosingJobStatus(
  jobName: string
): Promise<GeniusJobStatus> {
  try {
    return await withConnection(getOracleClient(), async (connection) => {
      const result = await connection.execute(
        `SELECT state, failure_count,
                TO_CHAR(last_start_date, 'YYYY-MM-DD HH24:MI:SS') as last_start,
                TO_CHAR(last_run_duration, 'HH24:MI:SS') as duration
         FROM user_scheduler_jobs
         WHERE job_name = :jobName`,
        { jobName },
        { outFormat: OUT_FORMAT_OBJECT }
      );

      if (!result.rows || result.rows.length === 0) {
        return {
          status: "NOT_FOUND",
          running: false,
          completed: false,
          failed: false,
          message: `Job ${jobName} not found. It may have been completed and cleaned up.`,
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

      let message = `Job ${jobName}: ${state}`;
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
    console.error("❌ Failed to check job status:", error);
    throw error;
  }
}
