import { join } from "node:path";
import { formatDateIndonesian } from "../../../utils/formatter";
import { renderTemplate } from "../../../utils/template";
import {
  formatEnDate,
  loadEmailTemplate,
} from "../../../utils/template/email-formatters";
import { getSignature } from "../../document-generation/pdf-assets";
import type { IReminderEmailData } from "../../reminder/types";

const TEMPLATES_DIR = join(__dirname, "../../../assets/email/templates");

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export async function generateReminderEmailHtml(
  type: string,
  data: IReminderEmailData,
  templateName = "TemplateReminderLetterSOA"
): Promise<string> {
  const template = loadEmailTemplate(TEMPLATES_DIR, templateName);
  const now = new Date();

  let dayDeadline = "19";
  if (type === "1") {
    dayDeadline = "19";
  } else if (type === "2") {
    dayDeadline = "25";
  } else if (type === "3") {
    dayDeadline = "29";
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
      return `Premium Invoice - ${customerName}`;
  }
}
