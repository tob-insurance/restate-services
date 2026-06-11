import { describe, expect, it } from "bun:test";
import { formatLetterNumber } from "./letter.formatter.js";

describe("formatLetterNumber", () => {
  it("formats basic letter number", () => {
    const result = formatLetterNumber(1, "1", new Date(2026, 4, 19));
    expect(result).toBe("001/FIN/SOA/RL1/V/2026");
  });

  it("pads sequence number to 3 digits", () => {
    expect(formatLetterNumber(7, "2", new Date(2026, 4, 19))).toBe(
      "007/FIN/SOA/RL2/V/2026"
    );
    expect(formatLetterNumber(42, "3", new Date(2026, 4, 19))).toBe(
      "042/FIN/SOA/RL3/V/2026"
    );
    expect(formatLetterNumber(100, "4", new Date(2026, 4, 19))).toBe(
      "100/FIN/SOA/RL4/V/2026"
    );
  });

  it("uses Roman numeral for month", () => {
    expect(formatLetterNumber(1, "1", new Date(2026, 0, 1))).toBe(
      "001/FIN/SOA/RL1/I/2026"
    );
    expect(formatLetterNumber(1, "1", new Date(2026, 11, 1))).toBe(
      "001/FIN/SOA/RL1/XII/2026"
    );
  });

  it("uses correct year", () => {
    expect(formatLetterNumber(1, "1", new Date(2025, 5, 15))).toBe(
      "001/FIN/SOA/RL1/VI/2025"
    );
  });
});
