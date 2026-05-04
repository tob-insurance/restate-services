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
 *   "initialized" → boolean (set after backfill)
 *   "counter"     → number (current sequence value)
 *
 * This is a pure counter: it guarantees uniqueness, NOT gaplessness.
 * Numbers are allocated lazily — call this as late as possible in the
 * letter generation flow (after document generation succeeds, before
 * recording the letter).
 *
 * The `backfill` handler MUST be called at least once (even with counter: 0)
 * before `getNext` can be used. This prevents sequence number reuse when
 * migrating from an existing system with historical data.
 */
export const letterCounter = object({
  name: "LetterCounter",
  handlers: {
    getNext: async (ctx: ObjectContext) => {
      const initialized = (await ctx.get<boolean>("initialized")) ?? false;
      if (!initialized) {
        throw new TerminalError(
          "LetterCounter not initialized: call backfill first"
        );
      }

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
     * Only updates if the new value is higher than the current counter.
     * Sets the `initialized` flag so `getNext` can proceed.
     *
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
      ctx.set("initialized", true);
    },
  },
});

export type LetterCounter = typeof letterCounter;
