export { TIMEZONE } from "@restate-tob/shared";
export const DEFAULT_USER_ID = "adm";

const scheduleTime = process.env.DAILY_CLOSING_SCHEDULE_TIME ?? "23:00";
const TIME_FORMAT_REGEX = /^(\d{1,2}):(\d{2})$/;
const timeMatch = scheduleTime.match(TIME_FORMAT_REGEX);

if (!timeMatch) {
  throw new Error(
    `Invalid DAILY_CLOSING_SCHEDULE_TIME: "${scheduleTime}". Expected format: HH:mm (e.g., "02:30", "14:00")`
  );
}

const hour = Number.parseInt(timeMatch[1], 10);
const minute = Number.parseInt(timeMatch[2], 10);

if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
  throw new Error(
    `Invalid DAILY_CLOSING_SCHEDULE_TIME: "${scheduleTime}". Hour (0-23) or minute (0-59) out of range.`
  );
}

export const DAILY_CLOSING_SCHEDULE_TIME = scheduleTime;
