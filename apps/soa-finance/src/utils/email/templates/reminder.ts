import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IReminderEmailData } from "../../../types";
import { formatDateIndonesian } from "../../formatter";
import { getSignature } from "../../generators";
import { renderTemplate } from "../../template";

const TEMPLATES_DIR = join(__dirname, "../../../assets/email/templates");

function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, `${name}.html`), "utf-8");
}

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const enDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function formatEnDate(date: Date): string {
  return enDateFormatter.format(date);
}

export async function generateReminderEmailHtml(
  type: string,
  data: IReminderEmailData,
  templateName = "TemplateReminderLetterSOA"
): Promise<string> {
  const template = loadTemplate(templateName);
  const now = new Date();

  let dayDeadline = "18";
  if (type === "1") {
    dayDeadline = "18";
  } else if (type === "2") {
    dayDeadline = "24";
  } else if (type === "3") {
    dayDeadline = "28";
  }

  const deadlineDateId = `${dayDeadline} ${formatDateIndonesian(now).split(" ").slice(1).join(" ")}`;
  const deadlineDateEn = `${dayDeadline} ${formatEnDate(now).split(" ").slice(1).join(" ")}`;

  return await renderTemplate(template, {
    reminderType: type,
    customerName: data.customerName,
    letterNo: data.letterNo,
    previousLetterNo: data.previousLetterNo,
    virtualAccount: data.virtualAccount,
    formattedDate: formatDateIndonesian(data.asAtDate),
    formattedDateEn: formatEnDate(data.asAtDate),
    formattedSentDate: data.previousLetterDate
      ? formatDateIndonesian(data.previousLetterDate)
      : "-",
    formattedSentDateEn: data.previousLetterDate
      ? formatEnDate(data.previousLetterDate)
      : "-",
    branch: data.branch || "",
    formattedTotalPremium: data.totalPremium
      ? currencyFormatter.format(data.totalPremium)
      : "0.00",
    deadlineDateId,
    deadlineDateEn,
    ImgSign: getSignature(),
  });
}

export function getReminderEmailSubject(
  type: string,
  customerName: string
): string {
  switch (type) {
    case "1":
      return `1st Reminder Letter - ${customerName}`;
    case "2":
      return `2nd Reminder Letter - ${customerName}`;
    case "3":
      return `Warning Letter - ${customerName}`;
    default:
      return `Tagihan Premi - ${customerName}`;
  }
}
