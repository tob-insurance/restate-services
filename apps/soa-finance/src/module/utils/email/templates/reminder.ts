import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatDateIndonesian } from "../../formatter";
import { renderTemplate } from "../../template";
import type { IReminderEmailData } from "../../types/reminder";

const TEMPLATES_DIR = join(__dirname, "html");

function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, `${name}.html`), "utf-8");
}

export async function generateRL1EmailHtml(
  data: IReminderEmailData
): Promise<string> {
  const template = loadTemplate("rl1Email");
  return await renderTemplate(template, {
    customerName: data.customerName,
    letterNo: data.letterNo,
    virtualAccount: data.virtualAccount,
    formattedDate: formatDateIndonesian(data.asAtDate),
  });
}

export async function generateRL2EmailHtml(
  data: IReminderEmailData
): Promise<string> {
  const template = loadTemplate("rl2Email");
  return await renderTemplate(template, {
    customerName: data.customerName,
    letterNo: data.letterNo,
    previousLetterNo: data.previousLetterNo,
    virtualAccount: data.virtualAccount,
    formattedDate: formatDateIndonesian(data.asAtDate),
  });
}

export async function generateRL3EmailHtml(
  data: IReminderEmailData
): Promise<string> {
  const template = loadTemplate("rl3Email");
  return await renderTemplate(template, {
    customerName: data.customerName,
    letterNo: data.letterNo,
    previousLetterNo: data.previousLetterNo,
    virtualAccount: data.virtualAccount,
    formattedDate: formatDateIndonesian(data.asAtDate),
  });
}

export async function generateReminderEmailHtml(
  type: string,
  data: IReminderEmailData
): Promise<string> {
  switch (type) {
    case "1":
      return await generateRL1EmailHtml(data);
    case "2":
      return await generateRL2EmailHtml(data);
    case "3":
      return await generateRL3EmailHtml(data);
    default:
      return await generateRL1EmailHtml(data);
  }
}

export function getReminderEmailSubject(
  type: string,
  customerName: string
): string {
  switch (type) {
    case "1":
      return `[REMINDER I] Tagihan Premi - ${customerName}`;
    case "2":
      return `[REMINDER II - URGENT] Tagihan Premi - ${customerName}`;
    case "3":
      return `[PERINGATAN TERAKHIR] Tagihan Premi - ${customerName}`;
    default:
      return `Tagihan Premi - ${customerName}`;
  }
}
