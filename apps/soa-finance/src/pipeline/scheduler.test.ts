import { describe, expect, it } from "bun:test";
import { DateTime } from "luxon";
import { computeNextRun } from "./scheduler";

const MOCK_SCHEDULES = [
  { type: "SOA" as const, soaType: 1 as const, sendDay: 4, graceDays: 0 },
  { type: "RL1" as const, soaType: 2 as const, sendDay: 11, graceDays: 7 },
  { type: "RL2" as const, soaType: 3 as const, sendDay: 19, graceDays: 5 },
  { type: "WL" as const, soaType: 4 as const, sendDay: 25, graceDays: 3 },
];

describe("computeNextRun", () => {
  it("returns next schedule in the same month", () => {
    const now = DateTime.fromISO("2026-05-10T10:00:00", {
      zone: "Asia/Jakarta",
    });
    const result = computeNextRun(now, MOCK_SCHEDULES);
    expect(result.schedule.soaType).toBe(2);
    expect(result.schedule.type).toBe("RL1");
  });

  it("wraps to next month when no schedules remain", () => {
    const now = DateTime.fromISO("2026-05-26T10:00:00", {
      zone: "Asia/Jakarta",
    });
    const result = computeNextRun(now, MOCK_SCHEDULES);
    expect(result.schedule.soaType).toBe(1);
    expect(result.targetTime.month).toBe(6);
    expect(result.targetTime.day).toBe(4);
  });

  it("selects today when before cutoff time", () => {
    const now = DateTime.fromISO("2026-05-04T00:59:59", {
      zone: "Asia/Jakarta",
    });
    const result = computeNextRun(now, MOCK_SCHEDULES);
    expect(result.schedule.type).toBe("SOA");
  });

  it("returns today's schedule at 1:00 AM when evaluated before cutoff", () => {
    const now = DateTime.fromISO("2026-05-04T00:00:00", {
      zone: "Asia/Jakarta",
    });
    const result = computeNextRun(now, MOCK_SCHEDULES);
    expect(result.schedule.type).toBe("SOA");
    expect(result.targetTime.hour).toBe(1);
    expect(result.targetTime.minute).toBe(0);
  });

  it("skips today when past cutoff time", () => {
    const now = DateTime.fromISO("2026-05-04T02:00:00", {
      zone: "Asia/Jakarta",
    });
    const result = computeNextRun(now, MOCK_SCHEDULES);
    expect(result.schedule.type).toBe("RL1");
    expect(result.targetTime.day).toBe(11);
  });

  it("handles December to January year wrap", () => {
    const now = DateTime.fromISO("2026-12-26T10:00:00", {
      zone: "Asia/Jakarta",
    });
    const result = computeNextRun(now, MOCK_SCHEDULES);
    expect(result.schedule.type).toBe("SOA");
    expect(result.targetTime.year).toBe(2027);
    expect(result.targetTime.month).toBe(1);
    expect(result.targetTime.day).toBe(4);
  });

  it("handles end of month with no remaining schedules", () => {
    const now = DateTime.fromISO("2026-05-31T23:00:00", {
      zone: "Asia/Jakarta",
    });
    const result = computeNextRun(now, MOCK_SCHEDULES);
    expect(result.schedule.type).toBe("SOA");
    expect(result.targetTime.month).toBe(6);
    expect(result.targetTime.day).toBe(4);
  });

  it("keeps input order for multiple schedules with the same sendDay", () => {
    const now = DateTime.fromISO("2026-05-10T10:00:00", {
      zone: "Asia/Jakarta",
    });
    const schedules = [
      { type: "RL2" as const, soaType: 3 as const, sendDay: 11, graceDays: 5 },
      { type: "RL1" as const, soaType: 2 as const, sendDay: 11, graceDays: 7 },
    ];
    const result = computeNextRun(now, schedules);
    expect(result.schedule.type).toBe("RL2");
  });

  it("throws for empty schedule config", () => {
    const now = DateTime.fromISO("2026-05-10T10:00:00", {
      zone: "Asia/Jakarta",
    });
    let message = "";
    try {
      computeNextRun(now, []);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("No valid future schedule could be computed");
  });
});
