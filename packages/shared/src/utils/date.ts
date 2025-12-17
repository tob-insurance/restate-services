const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function validateDateFormat(date: string): boolean {
  if (!DATE_REGEX.test(date)) {
    return false;
  }
  const parsedDate = new Date(date);
  return !Number.isNaN(parsedDate.getTime());
}

export function parseDateParts(date: string): {
  year: string;
  month: string;
  day: string;
} {
  const [year, month, day] = date.split("-");
  return { year, month, day };
}
