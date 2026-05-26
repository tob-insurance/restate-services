import { describe, expect, it } from "bun:test";
import {
  formatDateDDMMYYYY,
  formatDateEnglish,
  formatDateEnglishMonthFirst,
  formatDateIndonesian,
  formatDateToUnixTimestamp,
  formatDuration,
  formatMonthEnglish,
  formatMonthIndonesian,
  formatTimePeriod,
  parseDate,
} from "./date.formatter.js";

describe("formatDateIndonesian", () => {
  it("formats date in Indonesian", () => {
    expect(formatDateIndonesian(new Date(2026, 4, 19))).toBe("19 Mei 2026");
  });

  it("handles January", () => {
    expect(formatDateIndonesian(new Date(2026, 0, 1))).toBe("1 Januari 2026");
  });

  it("handles December", () => {
    expect(formatDateIndonesian(new Date(2026, 11, 31))).toBe(
      "31 Desember 2026"
    );
  });
});

describe("formatDateDDMMYYYY", () => {
  it("formats date as DD/MM/YYYY", () => {
    expect(formatDateDDMMYYYY(new Date(2026, 4, 19))).toBe("19/05/2026");
  });

  it("pads single digit day and month", () => {
    expect(formatDateDDMMYYYY(new Date(2026, 0, 5))).toBe("05/01/2026");
  });

  it("returns empty string for undefined", () => {
    expect(formatDateDDMMYYYY(undefined)).toBe("");
  });

  it("returns empty string for null", () => {
    expect(formatDateDDMMYYYY(null as unknown as undefined)).toBe("");
  });

  it("handles numeric timestamp", () => {
    const timestamp = new Date(2026, 4, 19).getTime();
    expect(formatDateDDMMYYYY(timestamp)).toBe("19/05/2026");
  });
});

describe("formatDateEnglish", () => {
  it("formats date in English", () => {
    expect(formatDateEnglish(new Date(2026, 4, 19))).toBe("19 May 2026");
  });

  it("handles January", () => {
    expect(formatDateEnglish(new Date(2026, 0, 1))).toBe("1 January 2026");
  });
});

describe("formatDateEnglishMonthFirst", () => {
  it("formats date with month first", () => {
    expect(formatDateEnglishMonthFirst(new Date(2026, 4, 19))).toBe(
      "May 19 2026"
    );
  });
});

describe("formatMonthEnglish", () => {
  it("formats month and year in English", () => {
    expect(formatMonthEnglish(new Date(2026, 4, 19))).toBe("May 2026");
  });
});

describe("formatMonthIndonesian", () => {
  it("formats month and year in Indonesian", () => {
    expect(formatMonthIndonesian(new Date(2026, 4, 19))).toBe("Mei 2026");
  });
});

describe("formatTimePeriod", () => {
  it("formats as YYYY-MM", () => {
    expect(formatTimePeriod(new Date(2026, 4, 19))).toBe("2026-05");
  });
});

describe("formatDateToUnixTimestamp", () => {
  it("converts date to unix timestamp", () => {
    const date = new Date(2026, 4, 19);
    const expected = Math.floor(date.getTime() / 1000);
    expect(formatDateToUnixTimestamp(date)).toBe(expected);
  });
});

describe("formatDuration", () => {
  it("formats duration as HH:MM:SS", () => {
    const durationMs = (2 * 3600 + 30 * 60 + 45) * 1000; // 2h 30m 45s
    expect(formatDuration(durationMs)).toBe("02:30:45");
  });

  it("pads single digits", () => {
    const durationMs = (1 * 3600 + 5 * 60 + 9) * 1000; // 1h 5m 9s
    expect(formatDuration(durationMs)).toBe("01:05:09");
  });
});

describe("parseDate", () => {
  it("parses Date object", () => {
    expect(parseDate(new Date(2026, 4, 19))).toBe("5/19/2026");
  });

  it("parses date string", () => {
    expect(parseDate("2026-05-19")).toBe("5/19/2026");
  });

  it("returns '-' for null", () => {
    expect(parseDate(null)).toBe("-");
  });

  it("returns '-' for undefined", () => {
    expect(parseDate(undefined)).toBe("-");
  });

  it("returns '-' for invalid date", () => {
    expect(parseDate("invalid")).toBe("-");
  });
});
