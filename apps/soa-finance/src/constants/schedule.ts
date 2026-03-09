import type { SoaType } from "../types";

export type IScheduleConfig = {
  type: "SOA" | "RL1" | "RL2" | "WL";
  soaType: SoaType;
  sendDay: number;
};

export const SCHEDULE_CONFIG: IScheduleConfig[] = [
  { type: "SOA", soaType: 1, sendDay: 4 },
  { type: "RL1", soaType: 2, sendDay: 11 },
  { type: "RL2", soaType: 3, sendDay: 19 },
  { type: "WL", soaType: 4, sendDay: 25 },
];
