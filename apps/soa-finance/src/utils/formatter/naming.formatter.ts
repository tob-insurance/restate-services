import { randomUUID } from "node:crypto";

/**
 * Generate a random suffix for file names to prevent URL guessing.
 * Uses UUID v4 for cryptographically random strings.
 */
const randomSuffix = (): string => randomUUID().slice(0, 8);

export const reminderPdfName = (_reminderCount: number | string): string =>
  `Reminder-Letter-${randomSuffix()}.pdf`;

export const letterSoaPdfName = (customerCode: string): string =>
  `Collection-Letter-${customerCode}-${randomSuffix()}.pdf`;

export const excelSoaName = (): string =>
  `Outstanding-SOA-${randomSuffix()}.xlsx`;
