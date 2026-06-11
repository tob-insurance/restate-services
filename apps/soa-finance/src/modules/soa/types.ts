import { z } from "zod";

export const soaSchema = z.object({
  type: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

export type soaSchema = z.infer<typeof soaSchema>;

export const multiBranchCodes = ["DIC", "DIP", "DIG", "DID"];
