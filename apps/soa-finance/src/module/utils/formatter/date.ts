/**
 * Date Formatting Functions
 */

const INDONESIAN_MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export function formatIndonesianDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = INDONESIAN_MONTHS[date.getMonth()];
  const year = date.getFullYear();
  return `Jakarta, ${day} ${month} ${year}`;
}

export function formatDateIndonesian(date: Date): string {
  return `${date.getDate()} ${INDONESIAN_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatTimePeriod(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function formatDateToUnixTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function formatDuration(durationMs: number): string {
  const date = new Date(durationMs);
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mm = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");

  return `${hh}:${mm}:${ss}`;
}

export function parseDate(value: unknown): Date {
  if (!value) {
    return new Date(0);
  }
  if (value instanceof Date) {
    return value;
  }

  return new Date(value as string | number);
}
