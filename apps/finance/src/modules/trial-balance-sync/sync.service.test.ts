import { describe, expect, it } from "bun:test";

import { syncTrialBalanceFromGenius } from "./sync.service.js";

describe("syncTrialBalanceFromGenius", () => {
  it("returns validation error for invalid year", async () => {
    const result = await syncTrialBalanceFromGenius("123", "01", Date.now());
    expect(result.success).toBe(false);
    expect(result.recordsProcessed).toBe(0);
    expect(result.message).toContain("Invalid trial balance year");
  });

  it("returns validation error for invalid month", async () => {
    const result = await syncTrialBalanceFromGenius("2025", "13", Date.now());
    expect(result.success).toBe(false);
    expect(result.recordsProcessed).toBe(0);
    expect(result.message).toContain("Invalid trial balance month");
  });

  it("returns validation error for out-of-range month", async () => {
    const result = await syncTrialBalanceFromGenius("2025", "0", Date.now());
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid trial balance month");
  });

  it("returns validation error for non-numeric month", async () => {
    const result = await syncTrialBalanceFromGenius("2025", "abc", Date.now());
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid trial balance month");
  });
});
