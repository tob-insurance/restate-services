import type { SoaType } from "../types";

export interface IScheduleConfig {
  type: "SOA" | "RL1" | "RL2" | "RL3";
  soaType: SoaType;
  sendDay: number;
  dueDay?: number;
}

export const SCHEDULE_CONFIG: IScheduleConfig[] = [
  { type: "SOA", soaType: 1, sendDay: 4 },
  { type: "RL1", soaType: 2, sendDay: 11, dueDay: 18 },
  { type: "RL2", soaType: 3, sendDay: 19, dueDay: 24 },
  { type: "RL3", soaType: 4, sendDay: 25, dueDay: 28 },
];
