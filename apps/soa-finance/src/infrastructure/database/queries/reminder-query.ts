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
