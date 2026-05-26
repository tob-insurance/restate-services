import { describe, expect, it } from "bun:test";
import type { StatementOfAccountModel } from "../../types/soa.type.js";
import { filterAgingData } from "./fetch-soa-data.js";

function makeSoa(aging: number): StatementOfAccountModel {
  return {
    accountName: "Test",
    actingCode: "001",
    aging,
    branch: "JKT",
    coInFacRefNo: "",
    commission: 0,
    contractNo: "",
    cost: 0,
    currency: "IDR",
    debitAndCreditNoteNo: "DC001",
    discount: 0,
    distributionCode: "",
    distributionName: "",
    distributionNameSecond: "",
    dueDate: "2026-01-01",
    endEffDate: "",
    endExpDate: "",
    endReason: "",
    exchangeRate: 1,
    fireConjunctionPolicy: "",
    grossPremium: 0,
    installment: "",
    insuredName: "",
    lob: "",
    netPremium: 0,
    netPremiumIdr: 0,
    origAmount: 0,
    plateNo: "",
    policyEndNo: "",
    policyNo: "",
    postDate: "",
    pph21: 0,
    pph23: 0,
    ppn: 0,
    qualitateQuaName: "",
    sourceOfBusiness: "",
    stmp: 0,
    totalSumInsured: 0,
  };
}

describe("filterAgingData", () => {
  it("should return null for empty array", () => {
    expect(filterAgingData([])).toBe(null);
  });

  it("should return null when all items below threshold (60)", () => {
    const data = [makeSoa(30), makeSoa(50), makeSoa(59)];
    expect(filterAgingData(data)).toBe(null);
  });

  it("should filter items at or above threshold", () => {
    const data = [makeSoa(30), makeSoa(60), makeSoa(90)];
    const result = filterAgingData(data);
    expect(result).not.toBe(null);
    if (result) {
      expect(result.length).toBe(2);
      expect(result[0].aging).toBe(60);
      expect(result[1].aging).toBe(90);
    }
  });

  it("should return all items when all above threshold", () => {
    const data = [makeSoa(61), makeSoa(100)];
    const result = filterAgingData(data);
    expect(result).not.toBe(null);
    if (result) {
      expect(result.length).toBe(2);
    }
  });
});
