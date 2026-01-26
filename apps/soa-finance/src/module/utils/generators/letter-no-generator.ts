/**
 * Letter Number Generator
 * Format: XXX/FIN/SOA/RL{type}/{month_roman}/{year}
 * Example: 001/FIN/SOA/RL1/XII/2024
 */

import { getNextLetterSequence } from "../../../infrastructure/database/queries";
import { ROMAN_MONTHS } from "../constants";

export const generateLetterNo = async (
  type: string,
  date: Date = new Date()
): Promise<string> => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  const seqNo = await getNextLetterSequence(type, year, month);

  const paddedSeq = seqNo.toString().padStart(3, "0");
  const romanMonth = ROMAN_MONTHS[month - 1];

  return `${paddedSeq}/FIN/SOA/RL${type}/${romanMonth}/${year}`;
};
