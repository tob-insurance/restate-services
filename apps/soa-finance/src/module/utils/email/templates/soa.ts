import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatDateIndonesian } from "../../formatter";
import { renderTemplate } from "../../template";

const TEMPLATES_DIR = join(__dirname, "html");

const enDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function formatEnDate(date: Date): string {
  return enDateFormatter.format(date);
}

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
  const template = loadTemplate("TemplateOutstandingStatementOfAccount");
  return await renderTemplate(template, {
    customerName: data.customerName,
    virtualAccount: data.virtualAccount,
    formattedDate: formatDateIndonesian(data.asAtDate),
    formattedDateEn: formatEnDate(data.asAtDate),
  });
}
