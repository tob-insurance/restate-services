import { readFileSync } from "node:fs";
import { join } from "node:path";
import juice from "juice";
import { Liquid } from "liquidjs";

import { ASSETS_DIR } from "../paths";

const TEMPLATES_DIR = join(ASSETS_DIR, "email/templates");

const TEMPLATE_KEYS = [
  "_base",
  "_partials/bank-accounts-id",
  "_partials/bank-accounts-en",
  "_partials/signature",
  "_partials/contact-info",
  "TemplateOutstandingStatementOfAccount",
  "TemplateReminderLetterSOA",
] as const;

function loadTemplates(): Record<string, string> {
  const templates: Record<string, string> = {};
  for (const key of TEMPLATE_KEYS) {
    const filePath = join(TEMPLATES_DIR, `${key}.html`);
    templates[key] = readFileSync(filePath, "utf-8");
  }
  return templates;
}

const engine = new Liquid({
  templates: loadTemplates(),
  cache: process.env.NODE_ENV === "production",
  strictVariables: true,
  strictFilters: true,
  ownPropertyOnly: true,
  greedy: false,
});

export type EmailTemplateName = (typeof TEMPLATE_KEYS)[number];

export async function renderEmail(
  templateName: EmailTemplateName,
  data: Record<string, unknown>
): Promise<string> {
  const html = await engine.renderFile(templateName, data);
  return juice(html, {
    preserveImportant: true,
    preserveMediaQueries: true,
    removeStyleTags: true,
    insertPreservedExtraCss: false,
  });
}

const simpleLiquid = new Liquid({
  cache: process.env.NODE_ENV === "production",
});

export function renderString(
  template: string,
  data: Record<string, unknown>
): Promise<string> {
  return simpleLiquid.parseAndRender(template, data);
}
