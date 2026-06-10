import { withConnection } from "@restate-tob/postgres";
import { executeQuery, getPostgresClient } from "../postgres.js";

export interface ReminderHeaderRow {
  created_at: string;
  customer_code: string;
  office_id: string;
  time_period: string;
}

export interface ReminderDetailRow {
  dc_note_id: string;
  is_paid: boolean;
  reminder_id: string;
}

/**
 * Create or update reminder header
 */
export async function upsertReminderHeader(
  customerCode: string,
  timePeriod: string,
  officeId: string
): Promise<void> {
  await executeQuery(
    `INSERT INTO soa_reminder_headers (customer_code, time_period, office_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (customer_code, time_period, office_id)
     DO UPDATE SET created_at = NOW()`,
    [customerCode, timePeriod, officeId]
  );
}

/**
 * Create reminder details (bulk insert)
 */
export async function createReminderDetails(
  customerCode: string,
  timePeriod: string,
  officeId: string,
  reminderId: string,
  dcNoteIds: string[]
): Promise<void> {
  if (dcNoteIds.length === 0) {
    return;
  }

  // PostgreSQL wire protocol limit: 65,535 max parameters (uint16).
  // Chunk the bulk insert to stay well under the limit.
  // Each row uses 5 parameters, so 1000 rows = 5000 params.
  const CHUNK_SIZE = 1000;

  const client = getPostgresClient();
  await withConnection(client, async (conn) => {
    await conn.query("BEGIN");
    try {
      for (let i = 0; i < dcNoteIds.length; i += CHUNK_SIZE) {
        const chunk = dcNoteIds.slice(i, i + CHUNK_SIZE);

        const values: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        for (const dcNoteId of chunk) {
          values.push(
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`
          );
          params.push(customerCode, timePeriod, officeId, dcNoteId, reminderId);
          paramIndex += 5;
        }

        await conn.query(
          `INSERT INTO soa_reminder_details (customer_code, time_period, office_id, dc_note_id, reminder_id)
           VALUES ${values.join(", ")}
           ON CONFLICT (customer_code, time_period, office_id, dc_note_id)
           DO UPDATE SET reminder_id = EXCLUDED.reminder_id`,
          params
        );
      }
      await conn.query("COMMIT");
    } catch (error: unknown) {
      await conn.query("ROLLBACK").catch(() => {
        /* intentional: ignore rollback errors */
      });
      throw error;
    }
  });
}

/**
 * Check if customer has reminders for a period
 */
export async function hasRemindersForPeriod(
  customerCode: string,
  timePeriod: string
): Promise<boolean> {
  const result = await executeQuery(
    `SELECT EXISTS(
       SELECT 1 FROM soa_reminder_headers 
       WHERE customer_code = $1 AND time_period = $2
     ) as exists`,
    [customerCode, timePeriod]
  );
  return result.rows[0]?.exists === true;
}

/**
 * Get reminder IDs for a customer and period
 */
export async function getReminderIdsForPeriod(
  customerCode: string,
  timePeriod: string
): Promise<string[]> {
  const result = await executeQuery<{ reminder_id: string }>(
    `SELECT DISTINCT reminder_id 
     FROM soa_reminder_details 
     WHERE customer_code = $1 AND time_period = $2`,
    [customerCode, timePeriod]
  );
  return result.rows.map((row) => row.reminder_id);
}

/**
 * Get reminder headers for a customer and period
 */
export async function getReminderHeadersForPeriod(
  customerCode: string,
  timePeriod: string
): Promise<ReminderHeaderRow[]> {
  const result = await executeQuery<ReminderHeaderRow>(
    `SELECT customer_code, time_period, office_id, created_at
     FROM soa_reminder_headers 
     WHERE customer_code = $1 AND time_period = $2`,
    [customerCode, timePeriod]
  );
  return result.rows;
}

/**
 * Get unpaid DC notes for a customer and reminder
 */
export async function getUnpaidDcNotes(
  customerCode: string,
  timePeriod: string,
  officeId: string
): Promise<string[]> {
  const result = await executeQuery<{ dc_note_id: string }>(
    `SELECT dc_note_id 
     FROM soa_reminder_details 
     WHERE customer_code = $1 AND time_period = $2 AND office_id = $3 AND is_paid = FALSE`,
    [customerCode, timePeriod, officeId]
  );
  return result.rows.map((row) => row.dc_note_id);
}

/**
 * Get all reminder details for a customer and reminder
 */
export async function getReminderDetails(
  customerCode: string,
  timePeriod: string,
  officeId: string
): Promise<ReminderDetailRow[]> {
  const result = await executeQuery<ReminderDetailRow>(
    `SELECT dc_note_id, reminder_id, is_paid
     FROM soa_reminder_details 
     WHERE customer_code = $1 AND time_period = $2 AND office_id = $3`,
    [customerCode, timePeriod, officeId]
  );
  return result.rows;
}

/**
 * Mark DC notes as paid
 */
export async function markDcNotesAsPaid(
  customerCode: string,
  dcNoteIds: string[]
): Promise<void> {
  if (dcNoteIds.length === 0) {
    return;
  }

  await executeQuery(
    `UPDATE soa_reminder_details 
     SET is_paid = TRUE 
     WHERE customer_code = $1 AND dc_note_id = ANY($2)`,
    [customerCode, dcNoteIds]
  );
}

/**
 * Delete old reminder data (cleanup)
 */
export async function deleteOldReminders(
  customerCode: string,
  beforeTimePeriod: string
): Promise<void> {
  const client = getPostgresClient();
  await withConnection(client, async (conn) => {
    try {
      await conn.query("BEGIN");
      await conn.query(
        `DELETE FROM soa_reminder_details 
         WHERE customer_code = $1 AND time_period < $2`,
        [customerCode, beforeTimePeriod]
      );
      await conn.query(
        `DELETE FROM soa_reminder_headers 
         WHERE customer_code = $1 AND time_period < $2`,
        [customerCode, beforeTimePeriod]
      );
      await conn.query("COMMIT");
    } catch (error: unknown) {
      await conn.query("ROLLBACK").catch(() => {
        /* intentional: ignore rollback errors */
      });
      throw error;
    }
  });
}
