import { readFileSync } from "node:fs";
import { join } from "node:path";

const templateCache = new Map<string, string>();

const enDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatEnDate(date: Date): string {
  return enDateFormatter.format(date);
}

export function loadEmailTemplate(templatesDir: string, name: string): string {
  const cacheKey = join(templatesDir, `${name}.html`);
  const cached = templateCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const content = readFileSync(cacheKey, "utf-8");
  templateCache.set(cacheKey, content);
  return content;
}
