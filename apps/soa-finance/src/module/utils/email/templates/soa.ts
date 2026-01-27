/**
 * SOA Email Template Generator
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatDateIndonesian } from "../../formatter";
import { renderTemplate } from "../../template";

const TEMPLATES_DIR = join(__dirname, "../templates");

export type SoaEmailData = {
  customerName: string;
  asAtDate: Date;
  virtualAccount: string;
};

function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, `${name}.html`), "utf-8");
}

export async function generateSoaEmailHtml(
  data: SoaEmailData
): Promise<string> {
  const template = loadTemplate("soaEmail");
  return await renderTemplate(template, {
    customerName: data.customerName,
    virtualAccount: data.virtualAccount,
    formattedDate: formatDateIndonesian(data.asAtDate),
  });
}
