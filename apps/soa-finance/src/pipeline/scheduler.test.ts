import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DateTime } from "luxon";
import { SCHEDULE_CONFIG, TIMEZONE } from "../constants/index.js";
import { computeNextRun } from "./scheduler.js";

describe("computeNextRun", () => {
  test("keeps same-day schedule when current time is before cutoff", () => {
    const now = DateTime.fromISO("2026-04-04T00:30:00", { zone: TIMEZONE });

    const nextRun = computeNextRun(now, SCHEDULE_CONFIG);

    assert.equal(nextRun.schedule.type, "SOA");
    assert.equal(
      nextRun.targetTime.toISO(),
      DateTime.fromISO("2026-04-04T01:00:00", { zone: TIMEZONE }).toISO()
    );
  });

  test("moves to the next configured schedule after cutoff", () => {
    const now = DateTime.fromISO("2026-04-04T01:30:00", { zone: TIMEZONE });

    const nextRun = computeNextRun(now, SCHEDULE_CONFIG);

    assert.equal(nextRun.schedule.type, "RL1");
    assert.equal(
      nextRun.targetTime.toISO(),
      DateTime.fromISO("2026-04-11T01:00:00", { zone: TIMEZONE }).toISO()
    );
  });

  test("rolls to next month after the last schedule in the month", () => {
    const now = DateTime.fromISO("2026-04-25T02:00:00", { zone: TIMEZONE });

    const nextRun = computeNextRun(now, SCHEDULE_CONFIG);

    assert.equal(nextRun.schedule.type, "SOA");
    assert.equal(
      nextRun.targetTime.toISO(),
      DateTime.fromISO("2026-05-04T01:00:00", { zone: TIMEZONE }).toISO()
    );
  });
});
