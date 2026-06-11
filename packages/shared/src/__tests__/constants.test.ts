import { describe, expect, it } from "bun:test";
import { CONTENT_TYPES, TIMEZONE } from "../constants.js";

describe("TIMEZONE", () => {
  it("is defined and is a string", () => {
    expect(typeof TIMEZONE).toBe("string");
  });

  it("equals Asia/Jakarta", () => {
    expect(TIMEZONE).toBe("Asia/Jakarta");
  });
});

describe("CONTENT_TYPES", () => {
  it("has PDF entry", () => {
    expect(CONTENT_TYPES.PDF).toBe("application/pdf");
  });

  it("has XLSX entry", () => {
    expect(CONTENT_TYPES.XLSX).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("has XLS entry", () => {
    expect(CONTENT_TYPES.XLS).toBe("application/vnd.ms-excel");
  });

  it("has HTML entry", () => {
    expect(CONTENT_TYPES.HTML).toBe("text/html");
  });

  it("has CSV entry", () => {
    expect(CONTENT_TYPES.CSV).toBe("text/csv");
  });

  it("has OCTET_STREAM entry", () => {
    expect(CONTENT_TYPES.OCTET_STREAM).toBe("application/octet-stream");
  });

  it("has exactly 6 entries", () => {
    expect(Object.keys(CONTENT_TYPES)).toHaveLength(6);
  });

  it("is deeply read-only at type level", () => {
    const keys = Object.keys(CONTENT_TYPES);
    expect(keys).toEqual(["PDF", "XLSX", "XLS", "HTML", "CSV", "OCTET_STREAM"]);
  });
});
