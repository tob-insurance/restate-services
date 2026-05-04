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
 * The `backfill` handler is only needed when migrating from an existing
 * system — it sets the counter to the max existing sequence number.
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

    /**
     * Initialize counter from backfill data (max existing sequence number).
     * Only needed for migration — fresh deployments can skip this.
     * Safe to call multiple times — idempotent (max-based merge).
     */
    backfill: async (ctx: ObjectContext, data: unknown) => {
      if (typeof data !== "object" || data === null || !("counter" in data)) {
        throw new TerminalError(
          `Invalid backfill payload. Expected { counter: number }, got ${typeof data}`
        );
      }
      const payload = data as { counter: unknown };
      if (
        typeof payload.counter !== "number" ||
        !Number.isSafeInteger(payload.counter) ||
        payload.counter < 0
      ) {
        throw new TerminalError(
          `Invalid backfill counter: ${payload.counter}. Must be a non-negative safe integer.`
        );
      }

      const validatedCounter = payload.counter;
      const current = (await ctx.get<number>("counter")) ?? 0;
      if (validatedCounter > current) {
        ctx.set("counter", validatedCounter);
      }
    },
  },
});

export type LetterCounter = typeof letterCounter;
