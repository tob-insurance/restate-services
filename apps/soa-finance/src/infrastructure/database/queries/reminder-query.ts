import { v4 as uuidv4 } from "uuid";

import { formatUUID } from "../../../module/utils/formatter";
import { executeQuery } from "../database";

type DcNoteRow = { DC_NOTE_ID: string };

// get reminder by customer code and time period
export const getReminderByCustomerAndPeriod = async (
  customerCode: string,
  timePeriod: string
) => {
  const query =
    "SELECT ID as id, CM_CODE as customerCode, TIME_PERIOD as timePeriod, OFFICE_ID as officeId FROM SOA_REMINDER WHERE CM_CODE = :customerCode AND TIME_PERIOD = :timePeriod";

  const result = await executeQuery(query, { customerCode, timePeriod });
  return result.rows ?? [];
};

export const getDcNoteIdsByCustomer = async (
  cmCode: string
): Promise<string[]> => {
  const query = `
    SELECT srd.DC_NOTE_ID 
    FROM SOA_REMINDER_DETAIL srd
    LEFT JOIN SOA_REMINDER sr ON srd.REMINDER_ID = sr.ID 
    WHERE sr.CM_CODE = :cmCode
  `;

  const result = await executeQuery(query, { cmCode });
  const dcNoteIds =
    (result.rows as DcNoteRow[])?.map((r) => r.DC_NOTE_ID).filter(Boolean) ??
    [];

  return dcNoteIds;
};

/**
 * Insert a new reminder and return its ID
 */
export const insertReminder = async (
  cmCode: string,
  timePeriod: string,
  officeId: string
): Promise<string> => {
  // Generate UUID in JavaScript to avoid RETURNING INTO binding issues
  const id = formatUUID(uuidv4());

  const sql = `
    INSERT INTO SOA_REMINDER (ID, CM_CODE, TIME_PERIOD, OFFICE_ID)
    VALUES (hextoraw(:id), :cmCode, :timePeriod, :officeId)
  `;

  await executeQuery(
    sql,
    {
      id,
      cmCode,
      timePeriod,
      officeId: officeId || null,
    },
    { autoCommit: true }
  );

  return id;
};

/**
 * Insert reminder detail
 */
export const insertReminderDetail = async (
  dcNoteId: string,
  reminderId: string,
  isPaid = "N"
): Promise<void> => {
  const sql = `
    INSERT INTO SOA_REMINDER_DETAIL (DC_NOTE_ID, REMINDER_ID, IS_PAID)
    VALUES (:dcNoteId, hextoraw(:reminderId), :isPaid)
  `;

  await executeQuery(
    sql,
    { dcNoteId, reminderId, isPaid },
    { autoCommit: true }
  );
};
