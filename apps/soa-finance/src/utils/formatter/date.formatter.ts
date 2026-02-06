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

export function formatIndonesianDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = INDONESIAN_MONTHS[date.getMonth()];
  const year = date.getFullYear();
  return `Jakarta, ${day} ${month} ${year}`;
}

export function formatDateIndonesian(date: Date): string {
  return `${date.getDate()} ${INDONESIAN_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatDateDDMMYYYY(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatDateEnglish(date: Date): string {
  return `${date.getDate()} ${ENGLISH_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
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

export function calculateWaitUntilDay(
  targetDay: number,
  targetHour = 7,
  targetMinute = 0,
  fromDate: Date = new Date()
): number {
  const now = fromDate;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // 1. Tentukan target date pada bulan berjalan
  let targetDate = new Date(
    currentYear,
    currentMonth,
    targetDay,
    targetHour,
    targetMinute,
    0,
    0
  );

  // 2. Jika waktu sekarang sudah melewati target di bulan ini, jadwalkan untuk bulan depan
  if (now.getTime() >= targetDate.getTime()) {
    targetDate = new Date(
      currentYear,
      currentMonth + 1,
      targetDay,
      targetHour,
      targetMinute,
      0,
      0
    );
  }

  const waitTime = targetDate.getTime() - now.getTime();
  return Math.max(0, waitTime);
}
