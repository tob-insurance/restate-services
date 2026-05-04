import type { SoaType } from "../types";

export type IScheduleConfig = {
  type: "SOA" | "RL1" | "RL2" | "WL";
  soaType: SoaType;
  sendDay: number;
};

function parseScheduleDays(): number[] {
  const raw = process.env.SOA_SCHEDULE_DAYS;
  if (!raw) {
    return [4, 11, 19, 25];
  }
  const days = raw.split(",").map((s) => Number(s.trim()));
  if (
    days.length === 4 &&
    days.every((d) => Number.isFinite(d) && d >= 1 && d <= 31)
  ) {
    return days;
  }
  return [4, 11, 19, 25];
}

const [soaDay, rl1Day, rl2Day, wlDay] = parseScheduleDays();

export const SCHEDULE_CONFIG: IScheduleConfig[] = [
  { type: "SOA", soaType: 1, sendDay: soaDay },
  { type: "RL1", soaType: 2, sendDay: rl1Day },
  { type: "RL2", soaType: 3, sendDay: rl2Day },
  { type: "WL", soaType: 4, sendDay: wlDay },
];
