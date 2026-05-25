import { describe, expect, it } from "bun:test";
import {
  CONTENT_TYPES,
  DateStringSchema,
  logger,
  parseDateParts,
  TIMEZONE,
  UserIdSchema,
  UuidSchema,
} from "../index.js";

describe("index barrel exports", () => {
  it("exports TIMEZONE", () => {
    expect(TIMEZONE).toBe("Asia/Jakarta");
  });

  it("exports CONTENT_TYPES", () => {
    expect(CONTENT_TYPES).toBeDefined();
    expect(CONTENT_TYPES.PDF).toBe("application/pdf");
  });

  it("exports DateStringSchema", () => {
    const result = DateStringSchema.safeParse("2025-06-15");
    expect(result.success).toBe(true);
  });

  it("exports UserIdSchema", () => {
    const result = UserIdSchema.safeParse("test_user");
    expect(result.success).toBe(true);
  });

  it("exports UuidSchema", () => {
    const result = UuidSchema.safeParse("550e8400-e29b-41d4-a716-446655440000");
    expect(result.success).toBe(true);
  });

  it("exports parseDateParts", () => {
    const result = parseDateParts("2025-01-15");
    expect(result).toEqual({ year: "2025", month: "01", day: "15" });
  });

  it("exports logger", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });
});
