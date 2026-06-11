import { SoaType } from "../types/soa.type.js";

export interface ScheduleConfig {
  graceDays: number;
  sendDay: number;
  soaType: SoaType;
  type: "SOA" | "RL1" | "RL2" | "WL";
}

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
  throw new Error(
    `Invalid SOA_SCHEDULE_DAYS: "${raw}". Expected 4 comma-separated day numbers (1-31). Example: "4,11,19,25"`
  );
}

const [soaDay, rl1Day, rl2Day, wlDay] = parseScheduleDays();

export const SCHEDULE_CONFIG: ScheduleConfig[] = [
  { type: "SOA", soaType: SoaType.SOA, sendDay: soaDay, graceDays: 0 },
  { type: "RL1", soaType: SoaType.RL1, sendDay: rl1Day, graceDays: 7 },
  { type: "RL2", soaType: SoaType.RL2, sendDay: rl2Day, graceDays: 5 },
  { type: "WL", soaType: SoaType.WL, sendDay: wlDay, graceDays: 3 },
];
