import { z } from "zod";

export const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: "Invalid date format. Expected YYYY-MM-DD",
});

export const UserIdSchema = z.string().regex(/^[a-zA-Z0-9_]+$/, {
  message: "UserId must be alphanumeric with underscores only",
});

export const UuidSchema = z.uuid({
  message: "Invalid UUID format",
});

export const JobNameSchema = z.string().regex(/^[A-Z0-9_]+$/, {
  message: "Invalid job name format",
});
