import { withConnection } from "@restate-tob/postgres";
import { parseDateParts } from "@restate-tob/shared";
import { TerminalError } from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  DateStringSchema,
  getPostgresClient,
  UserIdSchema,
} from "../../../infrastructure/index.js";
import type { GeniusClosingJobSubmit } from "../types.js";

const SubmitJobInputSchema = z.object({
  closingDate: DateStringSchema,
  userId: UserIdSchema,
  currentTimeMillis: z.number().optional(),
});

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Synchronously runs the `get_master_data` stored procedure on the shared
 * PostgreSQL database (POSTGRES_URL). Resolves once the procedure returns;
 * throws on procedure-reported failure.
 *
 * Failure semantics: every error that surfaces *after* the CALL has been
 * issued is rethrown as a TerminalError. Re-running this 6-hour procedure
 * is unsafe (the server-side execution may still be in flight after a
 * client-socket drop, so a retry would race a duplicate run against the
 * original). Operators must investigate and rerun manually.
 */
export async function submitGeniusClosingJob(
  closingDate: string,
  userId = "adm",
  currentTimeMillis?: number
): Promise<GeniusClosingJobSubmit> {
  let validated: z.infer<typeof SubmitJobInputSchema>;
  try {
    validated = SubmitJobInputSchema.parse({
      closingDate,
      userId,
      currentTimeMillis,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new TerminalError(
        `Validation error: ${error.issues.map((e: z.ZodIssue) => e.message).join(", ")}`,
        { errorCode: 400 }
      );
    }
    throw error;
  }

  const startTime = validated.currentTimeMillis
    ? DateTime.fromMillis(validated.currentTimeMillis)
    : DateTime.now();

  const { year, month } = parseDateParts(validated.closingDate);
  const shortYear = String(year).slice(-2);
  const uniqueSuffix = startTime.toMillis().toString(36).toUpperCase();
  const jobName = `GNS_${shortYear}${month}_${uniqueSuffix}`;

  console.log(`🚀 Submitting Genius closing job: ${jobName}`);
  console.log(`   Year: ${year}, Month: ${month}, UserId: ${validated.userId}`);

  let callIssued = false;
  try {
    await withConnection(getPostgresClient(), async (client: PoolClient) => {
      await client.query("SET search_path TO acpdb");
      await client.query(`SET statement_timeout = ${SIX_HOURS_MS}`);

      // Set aggressive server-side TCP keepalive to prevent network/firewall
      // devices from dropping the connection during the long-running procedure.
      // Without this, firewalls may consider the connection "idle" (no data transfer)
      // even though there's an active query, and terminate it.
      await client.query("SET tcp_keepalives_idle = 10"); // seconds before first probe
      await client.query("SET tcp_keepalives_interval = 10"); // seconds between probes
      await client.query("SET tcp_keepalives_count = 6"); // max failed probes

      // Also set client-side socket keepalive for bidirectional protection.
      const stream = (
        client as unknown as {
          connection?: {
            stream?: {
              setKeepAlive?: (enable: boolean, delay: number) => void;
            };
          };
        }
      ).connection?.stream;
      if (stream?.setKeepAlive) {
        stream.setKeepAlive(true, 10_000); // 10-second keepalive interval
      }

      try {
        // Past this point the procedure has begun executing on Genius;
        // any error must be treated as terminal (see function header).
        callIssued = true;

        // Call the get_master_data procedure on Genius PostgreSQL.
        // PROCEDURE with INOUT params: (year, month_from, month_to, user_id, OUT status, OUT error_message)
        const result = await client.query(
          "CALL acpdb.package_rpt_ac_fi806__get_master_data($1, $2, $3, $4, $5, $6)",
          [
            String(year),
            String(month),
            String(month),
            validated.userId,
            null, // p_status (INOUT - will be populated by the procedure)
            null, // p_error_message (INOUT - will be populated by the procedure)
          ]
        );

        // Check procedure result status
        const row = result.rows?.[0];
        if (row) {
          const status = row.p_status;
          const errorMessage = row.p_error_message;
          if (status === "0") {
            throw new TerminalError(
              `Genius closing procedure reported failure: ${errorMessage || "Unknown error"}`,
              { errorCode: 500 }
            );
          }
          console.log(
            `   Procedure status: ${status}, message: ${errorMessage}`
          );
        }
      } finally {
        try {
          await client.query("RESET statement_timeout");
          await client.query("RESET search_path");
        } catch (resetErr) {
          console.warn(
            "RESET session settings failed (connection likely dropped):",
            resetErr instanceof Error ? resetErr.message : resetErr
          );
        }
      }
    });
  } catch (error) {
    if (error instanceof TerminalError) {
      throw error;
    }
    if (callIssued) {
      const message = error instanceof Error ? error.message : String(error);
      throw new TerminalError(
        `Genius closing job ${jobName} failed mid-execution and cannot be retried automatically (manual investigation required): ${message}`,
        { errorCode: 500 }
      );
    }
    throw error;
  }

  console.log(`✅ Job ${jobName} completed successfully`);

  return {
    submitted: true,
    jobName,
    message: "Job completed successfully via direct PostgreSQL function call.",
    startTime,
  };
}
