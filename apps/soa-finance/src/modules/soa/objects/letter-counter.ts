import {
  type ObjectContext,
  object,
  TerminalError,
} from "@restatedev/restate-sdk";

/**
 * LetterCounter — global sequence number generator for reminder letters.
 *
 * Key format: "{type}:{year}:{month}"  (e.g. "1:2026:1")
 * Key space: ~48/year (4 types × 12 months)
 *
 * State:
 *   "counter" → number (current sequence value, starts at 0)
 *
 * This is a pure counter: it guarantees uniqueness, NOT gaplessness.
 * Starts from 0 on first call, so the first allocated number is 1.
 */
export const letterCounter = object({
  name: "LetterCounter",
  handlers: {
    getNext: async (ctx: ObjectContext) => {
      const current = (await ctx.get<number>("counter")) ?? 0;
      if (!Number.isSafeInteger(current) || current < 0) {
        throw new TerminalError(`Corrupted counter state: ${current}`);
      }

      const next = current + 1;
      if (next > Number.MAX_SAFE_INTEGER) {
        throw new TerminalError("Counter overflow");
      }

      ctx.set("counter", next);
      return next;
    },
  },
});

export type LetterCounter = typeof letterCounter;
