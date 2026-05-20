import type { SoaType } from "../types/soa.type.js";

export type IScheduleConfig = {
  type: "SOA" | "RL1" | "RL2" | "WL";
  soaType: SoaType;
  sendDay: number;
  graceDays: number;
};

function parseScheduleDays(): number[] {
  const raw = process.env.SOA_SCHEDULE_DAYS;
  if (!raw) {
    // Business default schedule days; override with SOA_SCHEDULE_DAYS when needed.
    return [4, 11, 19, 25];
  }
  const days = raw.split(",").map((s) => Number(s.trim()));
  if (
    days.length === 4 &&
    days.every((d) => Number.isFinite(d) && d >= 1 && d <= 31)
  ) {
    return days;
  }
  // Invalid overrides fall back to the business default schedule days.
  return [4, 11, 19, 25];
}

const [soaDay, rl1Day, rl2Day, wlDay] = parseScheduleDays();

export const SCHEDULE_CONFIG: IScheduleConfig[] = [
  { type: "SOA", soaType: 1, sendDay: soaDay, graceDays: 0 },
  { type: "RL1", soaType: 2, sendDay: rl1Day, graceDays: 7 },
  { type: "RL2", soaType: 3, sendDay: rl2Day, graceDays: 5 },
  { type: "WL", soaType: 4, sendDay: wlDay, graceDays: 3 },
];
