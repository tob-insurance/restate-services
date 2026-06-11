import { describe, expect, it } from "bun:test";
import {
  DailyClosingInput,
  DailyClosingResult,
} from "./daily-closing.workflow.js";

describe("DailyClosingInput", () => {
  it("accepts valid input with all fields", () => {
    const result = DailyClosingInput.safeParse({
      date: "2025-01-15",
      skipGeniusClosing: false,
      skipFinancialMetrics: false,
      userId: "adm",
    });
    expect(result.success).toBe(true);
  });

  it("accepts minimal input with defaults", () => {
    const result = DailyClosingInput.parse({ date: "2025-01-15" });
    expect(result.skipGeniusClosing).toBe(false);
    expect(result.skipFinancialMetrics).toBe(false);
  });

  it("validates date format (YYYY-MM-DD)", () => {
    const result = DailyClosingInput.safeParse({
      date: "2025-01-15",
      skipGeniusClosing: false,
      skipFinancialMetrics: false,
      userId: "user_001",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date formats", () => {
    const ddmmyyyy = DailyClosingInput.safeParse({ date: "15-01-2025" });
    expect(ddmmyyyy.success).toBe(false);

    const empty = DailyClosingInput.safeParse({ date: "" });
    expect(empty.success).toBe(false);
  });

  it("accepts skipGeniusClosing=true", () => {
    const result = DailyClosingInput.parse({
      date: "2025-01-15",
      skipGeniusClosing: true,
    });
    expect(result.skipGeniusClosing).toBe(true);
  });
});

describe("DailyClosingResult", () => {
  it("accepts a full success result with all sub-results", () => {
    const result = DailyClosingResult.safeParse({
      workflowId: "test-123",
      date: "2025-01-15",
      geniusClosing: {
        success: true,
        startTime: "2025-01-15T00:00:00.000Z",
        endTime: "2025-01-15T06:00:00.000Z",
        duration: 21_600,
        message: "Completed successfully",
      },
      financialMetrics: {
        success: true,
        startTime: "2025-01-15T06:00:00.000Z",
        endTime: "2025-01-15T06:30:00.000Z",
        duration: 1800,
        message: "Completed successfully",
      },
      overallSuccess: true,
      totalDuration: 23_400,
    });
    expect(result.success).toBe(true);
  });

  it("accepts partial result without optional sub-results", () => {
    const result = DailyClosingResult.safeParse({
      workflowId: "test-123",
      date: "2025-01-15",
      overallSuccess: false,
      totalDuration: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = DailyClosingResult.safeParse({
      workflowId: "test-123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid totalDuration type", () => {
    const result = DailyClosingResult.safeParse({
      workflowId: "test-123",
      date: "2025-01-15",
      overallSuccess: true,
      totalDuration: "not-a-number",
    });
    expect(result.success).toBe(false);
  });
});
