import { describe, expect, it } from "bun:test";
import type { ReminderDetail } from "../soa/objects/state.js";
import { reconcilePayment } from "./reconcile-payment.js";

function createDetail(dcNoteId: string, isPaid = false): ReminderDetail {
  return {
    dcNoteId,
    isPaid,
    reminderId: "2026-05:MAIN",
  };
}

describe("reconcilePayment", () => {
  it("returns empty results when details is null", () => {
    const result = reconcilePayment(null, ["DC-1"]);
    expect(result).toEqual({
      paidDcNoteIds: [],
      updatedDetails: {},
      bulkPaymentSkipped: false,
    });
  });

  it("should handle empty details gracefully", () => {
    const result = reconcilePayment({}, ["DC001", "DC002"]);
    expect(result.paidDcNoteIds).toEqual([]);
    expect(result.bulkPaymentSkipped).toBe(false);
  });

  it("returns empty when all DC notes are still outstanding", () => {
    const details = {
      "DC-1": createDetail("DC-1"),
      "DC-2": createDetail("DC-2"),
    };
    const result = reconcilePayment(details, ["DC-1", "DC-2"]);
    expect(result.paidDcNoteIds).toEqual([]);
    expect(result.bulkPaymentSkipped).toBe(false);
  });

  it("marks DC notes as paid when they disappear from current list", () => {
    const details = {
      "DC-1": createDetail("DC-1"),
      "DC-2": createDetail("DC-2"),
      "DC-3": createDetail("DC-3"),
    };
    const result = reconcilePayment(details, ["DC-1", "DC-3"]);
    expect(result.paidDcNoteIds).toEqual(["DC-2"]);
    expect(result.updatedDetails["DC-2"].isPaid).toBe(true);
    expect(result.updatedDetails["DC-1"].isPaid).toBe(false);
  });

  it("skips bulk payment when all would be marked paid", () => {
    const details: Record<string, ReminderDetail> = {};
    for (let i = 1; i <= 6; i++) {
      details[`DC-${i}`] = createDetail(`DC-${i}`);
    }
    const result = reconcilePayment(details, []);
    expect(result.paidDcNoteIds).toEqual([]);
    expect(result.bulkPaymentSkipped).toBe(true);
  });

  it("handles case-insensitive DC note matching", () => {
    const details = {
      "dc-1": createDetail("dc-1"),
      "DC-2": createDetail("DC-2"),
    };
    const result = reconcilePayment(details, ["DC-1", "dc-2"]);
    expect(result.paidDcNoteIds).toEqual([]);
  });

  it("does not mark already-paid notes as paid again", () => {
    const details = {
      "DC-1": createDetail("DC-1", true),
      "DC-2": createDetail("DC-2"),
    };
    const result = reconcilePayment(details, []);
    expect(result.paidDcNoteIds).toEqual(["DC-2"]);
    expect(result.updatedDetails["DC-1"].isPaid).toBe(true);
  });

  it("does not skip bulk payment when below 80% threshold", () => {
    const details: Record<string, ReminderDetail> = {};
    for (let i = 1; i <= 10; i++) {
      details[`DC-${i}`] = createDetail(`DC-${i}`);
    }
    const result = reconcilePayment(details, ["DC-1", "DC-2", "DC-3"]);
    expect(result.paidDcNoteIds.length).toBe(7);
    expect(result.bulkPaymentSkipped).toBe(false);
  });

  it("skips bulk payment when at 80% threshold", () => {
    const details: Record<string, ReminderDetail> = {};
    for (let i = 1; i <= 10; i++) {
      details[`DC-${i}`] = createDetail(`DC-${i}`);
    }
    const result = reconcilePayment(details, ["DC-1", "DC-2"]);
    expect(result.paidDcNoteIds).toEqual([]);
    expect(result.bulkPaymentSkipped).toBe(true);
  });

  it("skips bulk payment when above 80% threshold", () => {
    const details: Record<string, ReminderDetail> = {};
    for (let i = 1; i <= 10; i++) {
      details[`DC-${i}`] = createDetail(`DC-${i}`);
    }
    const result = reconcilePayment(details, ["DC-1"]);
    expect(result.paidDcNoteIds).toEqual([]);
    expect(result.bulkPaymentSkipped).toBe(true);
  });

  it("does not apply bulk payment threshold when count is below minimum", () => {
    const details: Record<string, ReminderDetail> = {};
    for (let i = 1; i <= 4; i++) {
      details[`DC-${i}`] = createDetail(`DC-${i}`);
    }
    const result = reconcilePayment(details, []);
    expect(result.paidDcNoteIds.length).toBe(4);
    expect(result.bulkPaymentSkipped).toBe(false);
  });
});
