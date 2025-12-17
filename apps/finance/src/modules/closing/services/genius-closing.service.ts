import { withConnection } from "@restate-tob/oracle";
import { parseDateParts } from "@restate-tob/shared";
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
    const { year, month } = parseDateParts(closingDate);
    const jobName = `GENIUS_CLOSING_${year}_${month}_${startTime.toMillis()}`;

    console.log(`🚀 Submitting Genius closing job: ${jobName}`);
    console.log(`   Year: ${year}, Month: ${month}, UserId: ${userId}`);

    await withConnection(getOracleClient(), async (connection) => {
      await connection.execute(
        `BEGIN
           DBMS_SCHEDULER.CREATE_JOB (
             job_name   => '${jobName}',
             job_type   => 'PLSQL_BLOCK',
             job_action => 'BEGIN Package_Rpt_Ac_Fi806.get_master_data(:1, :2, :3, :4, :5, :6); END;',
             number_of_arguments => 6,
             enabled    => FALSE
           );

           DBMS_SCHEDULER.SET_JOB_ARGUMENT_VALUE('${jobName}', 1, '${year}');
           DBMS_SCHEDULER.SET_JOB_ARGUMENT_VALUE('${jobName}', 2, '${month}');
           DBMS_SCHEDULER.SET_JOB_ARGUMENT_VALUE('${jobName}', 3, '${month}');
           DBMS_SCHEDULER.SET_JOB_ARGUMENT_VALUE('${jobName}', 4, '${userId}');
           DBMS_SCHEDULER.SET_JOB_ARGUMENT_VALUE('${jobName}', 5, NULL);
           DBMS_SCHEDULER.SET_JOB_ARGUMENT_VALUE('${jobName}', 6, NULL);

           DBMS_SCHEDULER.ENABLE('${jobName}');
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
        `SELECT state, error#,
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
        "ERROR#": number;
        LAST_START: string;
        DURATION: string;
      };
      const state = row.STATE;
      const error = row["ERROR#"];
      const lastStart = row.LAST_START;
      const duration = row.DURATION;

      const running = state === "RUNNING";
      const completed = state === "SUCCEEDED" || state === "COMPLETED";
      const failed = state === "FAILED" || error > 0;

      let message = `Job ${jobName}: ${state}`;
      if (lastStart) {
        message += ` (started: ${lastStart})`;
      }
      if (duration) {
        message += ` (duration: ${duration})`;
      }
      if (error) {
        message += ` [Error: ${error}]`;
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
