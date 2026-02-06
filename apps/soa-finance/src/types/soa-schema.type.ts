import { z } from "zod";

export const soaSchema = z.object({
  type: z.number().int().min(1).max(4),
  testMode: z.boolean().optional().default(false),
  skipAgingFilter: z.boolean().optional().default(false),
  skipDcNoteCheck: z.boolean().optional().default(false),
});

export type soaSchema = z.infer<typeof soaSchema>;
