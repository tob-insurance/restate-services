import { describe, expect, it } from "bun:test";
import { TerminalError } from "@restatedev/restate-sdk";

import { syncTrialBalanceFromGenius } from "./sync.service.js";

describe("syncTrialBalanceFromGenius", () => {
  it("throws TerminalError for invalid year", () => {
    expect(syncTrialBalanceFromGenius("123", "01", Date.now())).rejects.toThrow(
      TerminalError
    );
    expect(syncTrialBalanceFromGenius("123", "01", Date.now())).rejects.toThrow(
      "Invalid trial balance year"
    );
  });

  it("throws TerminalError for invalid month", () => {
    expect(
      syncTrialBalanceFromGenius("2025", "13", Date.now())
    ).rejects.toThrow(TerminalError);
    expect(
      syncTrialBalanceFromGenius("2025", "13", Date.now())
    ).rejects.toThrow("Invalid trial balance month");
  });

  it("throws TerminalError for out-of-range month", () => {
    expect(syncTrialBalanceFromGenius("2025", "0", Date.now())).rejects.toThrow(
      TerminalError
    );
    expect(syncTrialBalanceFromGenius("2025", "0", Date.now())).rejects.toThrow(
      "Invalid trial balance month"
    );
  });

  it("throws TerminalError for non-numeric month", () => {
    expect(
      syncTrialBalanceFromGenius("2025", "abc", Date.now())
    ).rejects.toThrow(TerminalError);
    expect(
      syncTrialBalanceFromGenius("2025", "abc", Date.now())
    ).rejects.toThrow("Invalid trial balance month");
  });
});
