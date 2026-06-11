import { describe, expect, it } from "bun:test";

describe("LetterCounter", () => {
  describe("state management", () => {
    it("should export a valid Restate object", async () => {
      const { letterCounter } = await import("./letter-counter.js");
      expect(letterCounter).toBeDefined();
      expect(letterCounter.name).toBeDefined();
    });
  });
});
