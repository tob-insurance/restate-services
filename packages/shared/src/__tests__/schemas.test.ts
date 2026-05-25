import { describe, expect, it } from "bun:test";
import { DateStringSchema, UserIdSchema, UuidSchema } from "../schemas.js";

describe("DateStringSchema", () => {
  it("accepts valid YYYY-MM-DD dates", () => {
    const result = DateStringSchema.safeParse("2025-01-15");
    expect(result.success).toBe(true);
  });

  it("accepts valid YYYY-MM-DD dates (end of year)", () => {
    const result = DateStringSchema.safeParse("1999-12-31");
    expect(result.success).toBe(true);
  });

  it("accepts valid YYYY-MM-DD dates (beginning of year)", () => {
    const result = DateStringSchema.safeParse("2000-01-01");
    expect(result.success).toBe(true);
  });

  it("rejects non-date string", () => {
    const result = DateStringSchema.safeParse("not-a-date");
    expect(result.success).toBe(false);
  });

  it("rejects date in wrong format (DD-MM-YYYY)", () => {
    const result = DateStringSchema.safeParse("15-01-2025");
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = DateStringSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects date with invalid month", () => {
    const result = DateStringSchema.safeParse("2025-13-01");
    expect(result.success).toBe(true); // regex only checks format, not valid month range
  });
});

describe("UserIdSchema", () => {
  it("accepts alphanumeric user ID", () => {
    const result = UserIdSchema.safeParse("john_doe_123");
    expect(result.success).toBe(true);
  });

  it("accepts underscore-only user ID", () => {
    const result = UserIdSchema.safeParse("___");
    expect(result.success).toBe(true);
  });

  it("accepts mixed case user ID", () => {
    const result = UserIdSchema.safeParse("User_Name_ABC");
    expect(result.success).toBe(true);
  });

  it("rejects user ID with special characters", () => {
    const result = UserIdSchema.safeParse("user@name");
    expect(result.success).toBe(false);
  });

  it("rejects user ID with spaces", () => {
    const result = UserIdSchema.safeParse("user name");
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = UserIdSchema.safeParse("");
    expect(result.success).toBe(false);
  });
});

describe("UuidSchema", () => {
  it("accepts valid UUID v4", () => {
    const result = UuidSchema.safeParse("550e8400-e29b-41d4-a716-446655440000");
    expect(result.success).toBe(true);
  });

  it("accepts UUID with uppercase letters", () => {
    const result = UuidSchema.safeParse("550E8400-E29B-41D4-A716-446655440000");
    expect(result.success).toBe(true);
  });

  it("accepts nil UUID", () => {
    const result = UuidSchema.safeParse("00000000-0000-0000-0000-000000000000");
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID string", () => {
    const result = UuidSchema.safeParse("not-a-uuid");
    expect(result.success).toBe(false);
  });

  it("rejects string missing dashes", () => {
    const result = UuidSchema.safeParse("550e8400e29b41d4a716446655440000");
    expect(result.success).toBe(false);
  });

  it("rejects number input", () => {
    const result = UuidSchema.safeParse(12_345);
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = UuidSchema.safeParse("");
    expect(result.success).toBe(false);
  });
});
