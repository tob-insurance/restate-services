export const reminderPdfName = (reminderCount: number | string): string =>
  `Reminder_${reminderCount}.pdf`;

export const letterSoaPdfName = (customerCode: string): string =>
  `Collection_Letter_${customerCode}.pdf`;

export const excelSoaName = (
  customerCode: string,
  date: Date = new Date()
): string => {
  const ticks = date.getTime() * 10_000 + 621_355_968_000_000_000;
  return `Outstanding-SOA--${customerCode}-${ticks}.xlsx`;
};
