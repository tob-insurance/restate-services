import { randomUUID } from "node:crypto";

/**
 * Generate a random suffix for file names to prevent URL guessing.
 * Uses UUID v4 for cryptographically random strings.
 */
const randomSuffix = (): string => randomUUID().slice(0, 8);

export const reminderPdfName = (reminderCount: number | string): string =>
  `soa-reminder-${reminderCount}-${randomSuffix()}.pdf`;

export const letterSoaPdfName = (customerCode: string): string =>
  `soa-${customerCode}-${randomSuffix()}.pdf`;

export const excelSoaName = (
  customerCode: string,
  _date: Date = new Date()
): string => `soa-${customerCode}-${randomSuffix()}.xlsx`;
