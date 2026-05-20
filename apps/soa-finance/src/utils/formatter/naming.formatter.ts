import { DOTNET_TICKS_EPOCH_OFFSET } from "../../constants/constants.js";

export const reminderPdfName = (reminderCount: number | string): string =>
  `Reminder_${reminderCount}.pdf`;

export const letterSoaPdfName = (customerCode: string): string =>
  `Collection_Letter_${customerCode}.pdf`;

export const excelSoaName = (
  customerCode: string,
  date: Date = new Date()
): string => {
  // .NET DateTime.Ticks are measured from 0001-01-01, not the Unix epoch.
  const ticks = date.getTime() * 10_000 + DOTNET_TICKS_EPOCH_OFFSET;
  return `Outstanding-SOA--${customerCode}-${ticks}.xlsx`;
};
