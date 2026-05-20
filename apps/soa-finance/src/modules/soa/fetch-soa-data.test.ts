import { describe, expect, it } from "bun:test";
import type { IStatementOfAccountModel } from "../../types/soa.type";
import { filterAgingData } from "./fetch-soa-data";

function createMockSoa(
  overrides: Partial<IStatementOfAccountModel> = {}
): IStatementOfAccountModel {
  return {
    debitAndCreditNoteNo: "",
    branch: "",
    policyNo: "",
    policyEndNo: "",
    contractNo: "",
    plateNo: "",
    coInFacRefNo: "",
    fireConjunctionPolicy: "",
    lob: "",
    sourceOfBusiness: "",
    accountName: "",
    insuredName: "",
    distributionName: "",
    distributionNameSecond: "",
    qualitateQuaName: "",
    endEffDate: "",
    endExpDate: "",
    postDate: "",
    dueDate: "",
    aging: 0,
    currency: "",
    exchangeRate: 1,
    endReason: "",
    actingCode: "",
    totalSumInsured: 0,
    grossPremium: 0,
    discount: 0,
    commission: 0,
    ppn: 0,
    pph21: 0,
    pph23: 0,
    cost: 0,
    stmp: 0,
    netPremium: 0,
    netPremiumIdr: 0,
    installment: "",
    origAmount: 0,
    distributionCode: "",
    ...overrides,
  };
}

describe("filterAgingData", () => {
  it("returns null when given empty array", () => {
    expect(filterAgingData([])).toBe(null);
  });

  it("returns null when all items have aging below 60", () => {
    const soaList = [createMockSoa({ aging: 0 }), createMockSoa({ aging: 59 })];

    expect(filterAgingData(soaList)).toBe(null);
  });

  it("filters items with aging 60 or above", () => {
    const included = createMockSoa({
      aging: 60,
      debitAndCreditNoteNo: "DC-60",
    });
    const excluded = createMockSoa({
      aging: 59,
      debitAndCreditNoteNo: "DC-59",
    });
    const older = createMockSoa({ aging: 90, debitAndCreditNoteNo: "DC-90" });

    expect(JSON.stringify(filterAgingData([included, excluded, older]))).toBe(
      JSON.stringify([included, older])
    );
  });

  it("returns items in original order", () => {
    const first = createMockSoa({ aging: 90, debitAndCreditNoteNo: "DC-1" });
    const second = createMockSoa({ aging: 60, debitAndCreditNoteNo: "DC-2" });
    const third = createMockSoa({ aging: 75, debitAndCreditNoteNo: "DC-3" });

    expect(JSON.stringify(filterAgingData([first, second, third]))).toBe(
      JSON.stringify([first, second, third])
    );
  });

  it("handles mixed aging values", () => {
    const soaList = [
      createMockSoa({ aging: 10, debitAndCreditNoteNo: "DC-10" }),
      createMockSoa({ aging: 61, debitAndCreditNoteNo: "DC-61" }),
      createMockSoa({ aging: 30, debitAndCreditNoteNo: "DC-30" }),
      createMockSoa({ aging: 100, debitAndCreditNoteNo: "DC-100" }),
    ];

    expect(
      JSON.stringify(
        filterAgingData(soaList)?.map((soa) => soa.debitAndCreditNoteNo)
      )
    ).toBe(JSON.stringify(["DC-61", "DC-100"]));
  });

  it("includes one item exactly at aging 60", () => {
    const soa = createMockSoa({ aging: 60 });

    expect(JSON.stringify(filterAgingData([soa]))).toBe(JSON.stringify([soa]));
  });

  it("excludes items at aging 59", () => {
    const soa = createMockSoa({ aging: 59 });

    expect(filterAgingData([soa])).toBe(null);
  });
});
