/**
 * Date Formatting Functions
 */

import { SCHEDULE_CONFIG } from "../../constants/schedule.js";

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

const ENGLISH_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatDateIndonesian(date: Date): string {
  return `${date.getDate()} ${INDONESIAN_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatDateDDMMYYYY(
  value: string | number | Date | undefined
): string {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(Number(value));

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatDateEnglish(date: Date): string {
  return `${date.getDate()} ${ENGLISH_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatDateEnglishMonthFirst(date: Date): string {
  return `${ENGLISH_MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;
}

export function formatMonthEnglish(date: Date): string {
  return `${ENGLISH_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatMonthIndonesian(date: Date): string {
  return `${INDONESIAN_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
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

export function computeDeadline(
  type: string,
  processingDate: Date
): { deadlineId: string; deadlineEn: string } | null {
  const soaType = Number(type) + 1;
  const schedule = SCHEDULE_CONFIG.find((s) => s.soaType === soaType);
  const graceDays = schedule?.graceDays ?? 0;
  if (graceDays === 0) {
    return null;
  }
  const deadline = new Date(processingDate);
  deadline.setDate(deadline.getDate() + graceDays);
  return {
    deadlineId: formatDateIndonesian(deadline),
    deadlineEn: formatDateEnglishMonthFirst(deadline),
  };
}

export function parseDate(value: unknown): string {
  if (!value) {
    return "-";
  }

  let date: Date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string" || typeof value === "number") {
    date = new Date(value);
  } else {
    return "-";
  }

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  return `${month}/${day}/${year}`;
}
