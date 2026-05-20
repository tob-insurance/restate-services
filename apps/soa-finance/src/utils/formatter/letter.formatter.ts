import { ROMAN_MONTHS } from "../../constants/constants.js";

/**
 * Format a sequential number into a letter number:
 *   {padded3}/FIN/SOA/RL{type}/{roman}/{year}
 *
 * Example: formatLetterNumber(7, "2", new Date("2026-05-19"))
 *   → "007/FIN/SOA/RL2/V/2026"
 *
 * @param seqNo - Sequential number from LetterCounter (starts at 1)
 * @param type - Reminder type as string ("1", "2", "3" for RL1, RL2, WL)
 * @param date - Date context for month/year extraction
 */
export function formatLetterNumber(
  seqNo: number,
  type: string,
  date: Date
): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const padded = seqNo.toString().padStart(3, "0");
  const roman = ROMAN_MONTHS[month - 1];
  return `${padded}/FIN/SOA/RL${type}/${roman}/${year}`;
}
