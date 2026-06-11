export function parseDateParts(date: string): {
  year: string;
  month: string;
  day: string;
} {
  const [year, month, day] = date.split("-");
  return { year, month, day };
}
