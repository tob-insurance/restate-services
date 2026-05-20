import { describe, expect, it } from "bun:test";
import type { IStatementOfAccountModel } from "../../types/soa.type";
import { groupAndAggregateSoa, sortSoaData } from "./excel.generator";

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

describe("groupAndAggregateSoa", () => {
  it("returns empty array for empty input", () => {
    expect(JSON.stringify(groupAndAggregateSoa([]))).toBe(JSON.stringify([]));
  });

  it("groups items by policyNo-policyEndNo-installment key", () => {
    const result = groupAndAggregateSoa([
      createMockSoa({ policyNo: "P-1", policyEndNo: "0", installment: "1" }),
      createMockSoa({ policyNo: "P-1", policyEndNo: "0", installment: "1" }),
      createMockSoa({ policyNo: "P-2", policyEndNo: "0", installment: "1" }),
    ]);

    expect(result.length).toBe(2);
    expect(JSON.stringify(result.map((soa) => soa.policyNo))).toBe(
      JSON.stringify(["P-1", "P-2"])
    );
  });

  it("aggregates financial fields across grouped items", () => {
    const result = groupAndAggregateSoa([
      createMockSoa({
        policyNo: "P-1",
        policyEndNo: "0",
        installment: "1",
        grossPremium: 100,
        discount: 10,
        commission: 20,
        ppn: 3,
        pph21: 4,
        pph23: 5,
        cost: 6,
        stmp: 7,
        netPremium: 80,
        netPremiumIdr: 800,
      }),
      createMockSoa({
        policyNo: "P-1",
        policyEndNo: "0",
        installment: "1",
        grossPremium: 200,
        discount: 15,
        commission: 25,
        ppn: 8,
        pph21: 9,
        pph23: 10,
        cost: 11,
        stmp: 12,
        netPremium: 160,
        netPremiumIdr: 1600,
      }),
    ]);

    expect(result[0]?.grossPremium).toBe(300);
    expect(result[0]?.discount).toBe(25);
    expect(result[0]?.commission).toBe(45);
    expect(result[0]?.ppn).toBe(11);
    expect(result[0]?.pph21).toBe(13);
    expect(result[0]?.pph23).toBe(15);
    expect(result[0]?.cost).toBe(17);
    expect(result[0]?.stmp).toBe(19);
    expect(result[0]?.netPremium).toBe(240);
    expect(result[0]?.netPremiumIdr).toBe(2400);
  });

  it("clears debitAndCreditNoteNo for aggregated groups", () => {
    const result = groupAndAggregateSoa([
      createMockSoa({
        debitAndCreditNoteNo: "DC-1",
        policyNo: "P-1",
        policyEndNo: "0",
        installment: "1",
      }),
      createMockSoa({
        debitAndCreditNoteNo: "DC-2",
        policyNo: "P-1",
        policyEndNo: "0",
        installment: "1",
      }),
    ]);

    expect(result[0]?.debitAndCreditNoteNo).toBe("");
  });

  it("does not group Insurance Broker acting codes", () => {
    const soaList = [
      createMockSoa({
        actingCode: "IB001",
        debitAndCreditNoteNo: "DC-1",
        policyNo: "P-1",
        policyEndNo: "0",
        installment: "1",
      }),
      createMockSoa({
        actingCode: "IB001",
        debitAndCreditNoteNo: "DC-2",
        policyNo: "P-1",
        policyEndNo: "0",
        installment: "1",
      }),
    ];

    expect(JSON.stringify(groupAndAggregateSoa(soaList))).toBe(
      JSON.stringify(soaList)
    );
  });

  it("handles a single item", () => {
    const result = groupAndAggregateSoa([
      createMockSoa({
        debitAndCreditNoteNo: "DC-1",
        grossPremium: 100,
        policyNo: "P-1",
      }),
    ]);

    expect(result.length).toBe(1);
    expect(result[0]?.debitAndCreditNoteNo).toBe("");
    expect(result[0]?.grossPremium).toBe(100);
  });

  it("aggregates multiple items with the same group key", () => {
    const result = groupAndAggregateSoa([
      createMockSoa({
        policyNo: "P-1",
        policyEndNo: "1",
        installment: "2",
        netPremium: 10,
      }),
      createMockSoa({
        policyNo: "P-1",
        policyEndNo: "1",
        installment: "2",
        netPremium: 20,
      }),
      createMockSoa({
        policyNo: "P-1",
        policyEndNo: "1",
        installment: "2",
        netPremium: 30,
      }),
    ]);

    expect(result.length).toBe(1);
    expect(result[0]?.netPremium).toBe(60);
  });

  it("keeps items with different group keys separate", () => {
    const result = groupAndAggregateSoa([
      createMockSoa({
        policyNo: "P-1",
        policyEndNo: "0",
        installment: "1",
        netPremium: 10,
      }),
      createMockSoa({
        policyNo: "P-1",
        policyEndNo: "1",
        installment: "1",
        netPremium: 20,
      }),
      createMockSoa({
        policyNo: "P-1",
        policyEndNo: "0",
        installment: "2",
        netPremium: 30,
      }),
    ]);

    expect(result.length).toBe(3);
    expect(JSON.stringify(result.map((soa) => soa.netPremium))).toBe(
      JSON.stringify([10, 20, 30])
    );
  });
});

describe("sortSoaData", () => {
  it("sorts by policyNo alphabetically", () => {
    const result = sortSoaData([
      createMockSoa({ policyNo: "POL-C" }),
      createMockSoa({ policyNo: "POL-A" }),
      createMockSoa({ policyNo: "POL-B" }),
    ]);

    expect(JSON.stringify(result.map((soa) => soa.policyNo))).toBe(
      JSON.stringify(["POL-A", "POL-B", "POL-C"])
    );
  });

  it("sorts by policyEndNo when policyNo matches", () => {
    const result = sortSoaData([
      createMockSoa({ policyNo: "POL-A", policyEndNo: "2" }),
      createMockSoa({ policyNo: "POL-A", policyEndNo: "0" }),
      createMockSoa({ policyNo: "POL-A", policyEndNo: "1" }),
    ]);

    expect(JSON.stringify(result.map((soa) => soa.policyEndNo))).toBe(
      JSON.stringify(["0", "1", "2"])
    );
  });

  it("sorts by installment when policyNo and policyEndNo match", () => {
    const result = sortSoaData([
      createMockSoa({ policyNo: "POL-A", policyEndNo: "0", installment: "3" }),
      createMockSoa({ policyNo: "POL-A", policyEndNo: "0", installment: "1" }),
      createMockSoa({ policyNo: "POL-A", policyEndNo: "0", installment: "2" }),
    ]);

    expect(JSON.stringify(result.map((soa) => soa.installment))).toBe(
      JSON.stringify(["1", "2", "3"])
    );
  });

  it("returns empty array for empty input", () => {
    expect(JSON.stringify(sortSoaData([]))).toBe(JSON.stringify([]));
  });

  it("handles null or undefined fields gracefully", () => {
    const result = sortSoaData([
      createMockSoa({
        policyNo: "POL-B",
        policyEndNo: undefined as unknown as string,
        installment: undefined as unknown as string,
      }),
      createMockSoa({
        policyNo: null as unknown as string,
        policyEndNo: null as unknown as string,
        installment: null as unknown as string,
      }),
      createMockSoa({ policyNo: "POL-A", policyEndNo: "0", installment: "1" }),
    ]);

    expect(JSON.stringify(result.map((soa) => soa.policyNo))).toBe(
      JSON.stringify([null, "POL-A", "POL-B"])
    );
  });
});
