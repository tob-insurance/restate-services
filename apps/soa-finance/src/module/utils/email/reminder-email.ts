/**
 * SOA Reminder Email Logic
 * Functions for generating reminder letter emails (RL1, RL2, RL3)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderTemplate } from "../core";
import type { IReminderEmailData } from "../types/reminder";

const TEMPLATES_DIR = join(__dirname, "../templates");

/**
 * Format date to Indonesian format
 */
function formatDateIndonesian(date: Date): string {
  const months = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Load HTML template from file
 */
function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, `${name}.html`), "utf-8");
}

// ========== Template Generators ==========

/**
 * RL1 - First Reminder (Soft tone)
 */
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

/**
 * RL2 - Second Reminder (Medium urgency)
 */
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

/**
 * RL3 - Third/Final Reminder (Final warning)
 */
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

/**
 * Get reminder email HTML based on type
 */
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

/**
 * Get email subject based on reminder type
 */
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
      return `[REMINDER] Tagihan Premi - ${customerName}`;
  }
}
