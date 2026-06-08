import { randomUUID } from "node:crypto";

/**
 * Generate a random suffix for file names to prevent URL guessing.
 * Uses UUID v4 for cryptographically random strings.
 */
const randomSuffix = (): string => randomUUID().slice(0, 4);

export const reminderPdfName = (customerCode: string): string =>
  `Reminder-Letter-${customerCode}-${randomSuffix()}.pdf`;

export const letterSoaPdfName = (customerCode: string): string =>
  `Collection-Letter-${customerCode}-${randomSuffix()}.pdf`;

export const excelSoaName = (customerCode: string): string =>
  `Outstanding-SOA-${customerCode}-${randomSuffix()}.xlsx`;
