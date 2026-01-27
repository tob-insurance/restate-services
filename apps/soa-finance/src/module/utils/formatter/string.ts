/**
 * String Formatting Functions
 */

export function formatUUID(uuid: string): string {
  return uuid.replace(/-/g, "").toUpperCase();
}

export function parseString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return value.toString().trim();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");
}
