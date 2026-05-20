import {
  computeDeadline,
  formatDateIndonesian,
} from "../../../utils/formatter/date.formatter.js";
import { formatEnDate } from "../../../utils/template/email-formatters";
import type { EmailTemplateName } from "../../../utils/template/engine";
import { renderEmail } from "../../../utils/template/engine";
import type { IReminderEmailData } from "../../reminder/types";

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export async function generateReminderEmailHtml(
  type: string,
  data: IReminderEmailData,
  templateName: EmailTemplateName = "TemplateReminderLetterSOA"
): Promise<string> {
  const deadline = computeDeadline(type, data.asAtDate);

  return await renderEmail(templateName, {
    reminderType: type,
    customerName: data.customerName,
    letterNo: data.letterNo,
    previousLetterNo: data.previousLetterNo ?? "-",
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
