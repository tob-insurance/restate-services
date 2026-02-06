import { v4 as uuidv4 } from "uuid";

import { formatUUID } from "../../../utils/formatter";
import { executeMany, executeQuery } from "../database";

type DcNoteRow = { DC_NOTE_ID: string };

export const getReminderByCustomerAndPeriod = async (
  customerCode: string,
  timePeriod: string,
) => {
  const query =
    'SELECT ID as "id", CM_CODE as "customerCode", TIME_PERIOD as "timePeriod", OFFICE_ID as "officeId" FROM SOA_REMINDER WHERE CM_CODE = :customerCode AND TIME_PERIOD = :timePeriod';

  const result = await executeQuery(query, { customerCode, timePeriod });
  return result.rows ?? [];
};

export const getDcNoteIdsByCustomer = async (
  cmCode: string,
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

export const insertReminder = async (
  cmCode: string,
  timePeriod: string,
  officeId: string,
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
    { autoCommit: true },
  );

  return id;
};

export const insertReminderDetail = async (
  dcNoteId: string,
  reminderId: string,
  isPaid = "N",
): Promise<void> => {
  const sql = `
    INSERT INTO SOA_REMINDER_DETAIL (DC_NOTE_ID, REMINDER_ID, IS_PAID)
    VALUES (:dcNoteId, hextoraw(:reminderId), :isPaid)
  `;

  await executeQuery(
    sql,
    { dcNoteId, reminderId, isPaid },
    { autoCommit: true },
  );
};

export const insertReminderDetailsBulk = async (
  details: { dcNoteId: string; reminderId: string; isPaid?: string }[],
): Promise<void> => {
  const sql = `
    INSERT INTO SOA_REMINDER_DETAIL (DC_NOTE_ID, REMINDER_ID, IS_PAID)
    VALUES (:dcNoteId, hextoraw(:reminderId), :isPaid)
  `;

  const binds = details.map((d) => ({
    dcNoteId: d.dcNoteId,
    reminderId: d.reminderId,
    isPaid: d.isPaid || "N",
  }));

  await executeMany(sql, binds);
};

export const updatePaymentStatus = async (
  dcNoteId: string,
  isPaid: string,
): Promise<void> => {
  const query = `
    UPDATE SOA_REMINDER_DETAIL 
    SET IS_PAID = :isPaid
    WHERE DC_NOTE_ID = :dcNoteId
  `;

  await executeQuery(query, { dcNoteId, isPaid }, { autoCommit: true });
};

export const getUnpaidReminderDetail = async (reminderId: string) => {
  const query = `
    SELECT DC_NOTE_ID as "dcNoteId", REMINDER_ID as "reminderId", IS_PAID as "isPaid" 
    FROM SOA_REMINDER_DETAIL 
    WHERE REMINDER_ID = hextoraw(:reminderId) AND IS_PAID = 'N'
  `;

  const result = await executeQuery(query, { reminderId });
  const rows =
    (result.rows as { dcNoteId: string }[])?.map((r) => r.dcNoteId) ?? [];

  return rows;
};
