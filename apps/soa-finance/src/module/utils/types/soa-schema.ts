import { z } from "zod";

export const soaSchema = z.object({
  type: z.enum(["SOA", "RL1", "RL2", "RL3"]),
  testMode: z.boolean().optional().default(false),
  skipAgingFilter: z.boolean().optional().default(false),
  skipDcNoteCheck: z.boolean().optional().default(false),
});

export type soaSchema = z.infer<typeof soaSchema>;
