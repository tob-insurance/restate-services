import { z } from "zod";

export const soaSchema = z.object({
  type: z.number().int().min(1).max(4),
});

export type soaSchema = z.infer<typeof soaSchema>;

export const multiBranchCodes = ["DIC", "DIP", "DIG", "DID"];
