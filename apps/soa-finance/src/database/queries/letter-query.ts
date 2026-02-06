import { v4 as uuidv4 } from "uuid";
import { formatUUID } from "../../utils";
import { executeQuery } from "../database";

type LatestLetterResult = {
  id: string;
  type: string;
  sentDate: Date;
  letterNo: string;
};

export type ReminderLetterParams = {
  reminderId: string;
  type: string;
  letterNo: string;
  referenceId: string | null;
  sentDate: Date;
};

export const insertReminderLetter = (
  params: ReminderLetterParams,
): Promise<string> => insertReminderLetterInternal(params);

async function insertReminderLetterInternal(
  params: ReminderLetterParams,
): Promise<string> {
  const { reminderId, type, letterNo, referenceId, sentDate } = params;
  const id = formatUUID(uuidv4());

  const query = `
    INSERT INTO SOA_REMINDER_LETTER (ID, REMINDER_ID, TYPE, LETTER_NO, REFERENCE_ID, SENT_DATE)
    VALUES (hextoraw(:id), hextoraw(:reminderId), :type, :letterNo, 
            ${referenceId ? "hextoraw(:referenceId)" : "NULL"}, :sentDate)
  `;

  const binds: Record<string, undefined | string | Date> = {
    id,
    reminderId,
    type,
    letterNo,
    sentDate,
  };

  if (referenceId) {
    binds.referenceId = referenceId;
  }

  await executeQuery(query, binds, { autoCommit: true });

  return id;
}

export const getLatestLetter = async (
  reminderId: string | undefined,
): Promise<LatestLetterResult | null> => {
  if (!reminderId) {
    return null;
  }

  const query = `
    SELECT "id", "type", "sentDate", "letterNo" FROM (
      SELECT RAWTOHEX(ID) as "id", TYPE as "type", SENT_DATE as "sentDate", LETTER_NO as "letterNo"
      FROM SOA_REMINDER_LETTER
      WHERE REMINDER_ID = hextoraw(:reminderId)
      ORDER BY SENT_DATE DESC
    ) WHERE ROWNUM = 1
  `;

  const result = await executeQuery(query, { reminderId });
  const row = result.rows?.[0] as LatestLetterResult | undefined;

  return row ?? null;
};

export const getNextLetterSequence = async (
  type: string,
  year: number,
  month: number,
): Promise<number> => {
  const query = `
    SELECT COUNT(*) + 1 AS NEXT_NO
    FROM SOA_REMINDER_LETTER
    WHERE TYPE = :type
      AND EXTRACT(YEAR FROM SENT_DATE) = :year
      AND EXTRACT(MONTH FROM SENT_DATE) = :month
  `;

  const result = await executeQuery(query, { type, year, month });
  const row = result.rows?.[0] as { NEXT_NO: number } | undefined;

  return row?.NEXT_NO ?? 1;
};
