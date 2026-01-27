import { INDONESIAN_MONTHS } from "./constants";

export const formatUUID = (uuid: string) =>
  uuid.replace(/-/g, "").toUpperCase();

export const formatDuration = (durationMs: number) => {
  const date = new Date(durationMs);
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mm = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");

  return `${hh}:${mm}:${ss}`;
};

export const formatTimePeriod = (date: Date) => date.toISOString().slice(0, 7);

export const formatDateToUnixTimestamp = (date: Date) =>
  Math.floor(date.getTime() / 1000);

export const formatIndonesianDate = (date: Date): string => {
  const day = date.getDate().toString().padStart(2, "0");
  const month = INDONESIAN_MONTHS[date.getMonth()];
  const year = date.getFullYear();
  return `Jakarta, ${day} ${month} ${year}`;
};

export function parseNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }

  const num = Number.parseFloat(value.toString());
  return Number.isNaN(num) ? 0 : num;
}

export function parseString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return value.toString().trim();
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
