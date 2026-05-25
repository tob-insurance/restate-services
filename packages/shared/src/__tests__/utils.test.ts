import { describe, expect, it } from "bun:test";
import { logger, parseDateParts } from "../utils/index.js";

describe("parseDateParts", () => {
  it("parses valid date string into parts", () => {
    const result = parseDateParts("2025-01-15");
    expect(result).toEqual({ year: "2025", month: "01", day: "15" });
  });

  it("parses first day of year", () => {
    const result = parseDateParts("2024-01-01");
    expect(result).toEqual({ year: "2024", month: "01", day: "01" });
  });

  it("parses last day of year", () => {
    const result = parseDateParts("2023-12-31");
    expect(result).toEqual({ year: "2023", month: "12", day: "31" });
  });

  it("parses leap day", () => {
    const result = parseDateParts("2024-02-29");
    expect(result).toEqual({ year: "2024", month: "02", day: "29" });
  });

  it("returns string parts even for alphabet input", () => {
    const result = parseDateParts("abcd-ef-gh");
    expect(result).toEqual({ year: "abcd", month: "ef", day: "gh" });
  });

  it("handles input with fewer parts", () => {
    const result = parseDateParts("2025-01");
    expect(result.year).toBe("2025");
    expect(result.month).toBe("01");
    expect(result.day).toBeUndefined();
  });

  it("handles input with more parts", () => {
    const result = parseDateParts("2025-01-15-extra");
    expect(result.year).toBe("2025");
    expect(result.month).toBe("01");
    expect(result.day).toBe("15");
  });
});

describe("logger", () => {
  it("is defined", () => {
    expect(logger).toBeDefined();
  });

  it("has debug method", () => {
    expect(typeof logger.debug).toBe("function");
  });

  it("has info method", () => {
    expect(typeof logger.info).toBe("function");
  });

  it("has warn method", () => {
    expect(typeof logger.warn).toBe("function");
  });

  it("has error method", () => {
    expect(typeof logger.error).toBe("function");
  });

  it("has fatal method", () => {
    expect(typeof logger.fatal).toBe("function");
  });
});
