import { withConnection } from "@restate-tob/oracle";
import { parseDateParts } from "@restate-tob/shared";
import { DateTime } from "luxon";
import oracledb, { OUT_FORMAT_OBJECT } from "oracledb";
import { getOracleClient } from "../../../infrastructure/database.js";
import type {
  GeniusClosingJobSubmit,
  GeniusClosingResult,
  GeniusJobStatus,
  GeniusReadinessCheck,
} from "../types.js";

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

export async function executeGeniusClosing(
  closingDate: string,
  userId = "ASK"
): Promise<GeniusClosingResult> {
  const startTime = DateTime.now();

  try {
    const { year, month } = parseDateParts(closingDate);

    console.log(
      "🔄 Starting Genius closing procedure (Package_Rpt_Ac_Fi806.get_master_data)"
    );
    console.log(`   Year: ${year}, Month: ${month}, UserId: ${userId}`);

    const result = await withConnection(
      getOracleClient(),
      async (connection) =>
        await connection.execute(
          `BEGIN
           Package_Rpt_Ac_Fi806.get_master_data(
             :p_year,
             :p_from_month,
             :p_to_month,
             :p_userid,
             :p_status,
             :p_error_message
           );
         END;`,
          {
            p_year: { val: year, type: oracledb.STRING, dir: oracledb.BIND_IN },
            p_from_month: {
              val: month,
              type: oracledb.STRING,
              dir: oracledb.BIND_IN,
            },
            p_to_month: {
              val: month,
              type: oracledb.STRING,
              dir: oracledb.BIND_IN,
            },
            p_userid: {
              val: userId,
              type: oracledb.STRING,
              dir: oracledb.BIND_IN,
            },
            p_status: {
              type: oracledb.STRING,
              dir: oracledb.BIND_OUT,
              maxSize: 1,
            },
            p_error_message: {
              type: oracledb.STRING,
              dir: oracledb.BIND_OUT,
              maxSize: 100,
            },
          },
          {
            autoCommit: true,
          }
        )
    );

    const endTime = DateTime.now();
    const duration = endTime.diff(startTime, "seconds").seconds;

    const outBinds = result.outBinds as {
      p_status?: string;
      p_error_message?: string;
    };
    const status = outBinds?.p_status || "0";
    const errorMessage = outBinds?.p_error_message || "";

    const success = status === "1";

    if (success) {
      console.log(
        `✅ Genius closing completed successfully in ${duration} seconds`
      );
    } else {
      console.error(`❌ Genius closing failed with status: ${status}`);
      console.error(`   Error message: ${errorMessage}`);
    }

    return {
      success,
      startTime,
      endTime,
      duration,
      message: success
        ? `Closing completed successfully for ${year}-${month}`
        : `Closing failed: ${errorMessage}`,
      status,
      errorMessage,
    };
  } catch (error) {
    const endTime = DateTime.now();
    const duration = endTime.diff(startTime, "seconds").seconds;

    console.error("❌ Genius closing procedure failed with exception:", error);

    return {
      success: false,
      startTime,
      endTime,
      duration,
      message: error instanceof Error ? error.message : "Unknown error",
      status: "0",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function checkGeniusReadiness(): Promise<GeniusReadinessCheck> {
  try {
    return await withConnection(getOracleClient(), async (connection) => {
      const result = await connection.execute(
        `SELECT COUNT(*) as pending_count
         FROM v$transaction`,
        [],
        { outFormat: OUT_FORMAT_OBJECT }
      );

      const pendingCount =
        (result.rows?.[0] as { PENDING_COUNT: number } | undefined)
          ?.PENDING_COUNT || 0;

      if (pendingCount > 0) {
        return {
          ready: false,
          message: `${pendingCount} pending transactions found. Please complete them before closing.`,
        };
      }

      return {
        ready: true,
        message: "Genius system is ready for closing",
      };
    });
  } catch (error) {
    return {
      ready: false,
      message:
        error instanceof Error
          ? error.message
          : "Unknown error checking readiness",
    };
  }
}
