import { join } from "node:path";
import { SCHEDULE_CONFIG } from "../../../constants/schedule";
import {
  formatDateEnglishMonthFirst,
  formatDateIndonesian,
} from "../../../utils/formatter";
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

function computeDeadline(
  type: string,
  processingDate: Date
): { deadlineId: string; deadlineEn: string } | null {
  const soaType = Number(type) + 1;
  const schedule = SCHEDULE_CONFIG.find((s) => s.soaType === soaType);
  const graceDays = schedule?.graceDays ?? 0;
  if (graceDays === 0) {
    return null;
  }
  const deadline = new Date(processingDate);
  deadline.setDate(deadline.getDate() + graceDays);
  return {
    deadlineId: formatDateIndonesian(deadline),
    deadlineEn: formatDateEnglishMonthFirst(deadline),
  };
}

export async function generateReminderEmailHtml(
  type: string,
  data: IReminderEmailData,
  templateName = "TemplateReminderLetterSOA"
): Promise<string> {
  const template = loadEmailTemplate(TEMPLATES_DIR, templateName);

  const deadline = computeDeadline(type, data.asAtDate);

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
    deadlineDateId: deadline?.deadlineId ?? "",
    deadlineDateEn: deadline?.deadlineEn ?? "",
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
