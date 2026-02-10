import { z } from "zod";

export const soaSchema = z.object({
  type: z.number().int().min(1).max(4),
  skipAgingFilter: z.boolean().optional().default(false),
  skipDcNoteCheck: z.boolean().optional().default(false),
});

export type soaSchema = z.infer<typeof soaSchema>;

export const multiBranchCodes = ["DIC", "DIP", "DIG", "DID"];
