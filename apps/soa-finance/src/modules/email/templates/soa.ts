import { join } from "node:path";
import { formatDateIndonesian } from "../../../utils/formatter";
import { renderTemplate } from "../../../utils/template";
import {
  formatEnDate,
  loadEmailTemplate,
} from "../../../utils/template/email-formatters";

const TEMPLATES_DIR = join(__dirname, "../../../assets/email/templates");

export type SoaEmailData = {
  customerName: string;
  asAtDate: Date;
  virtualAccount: string;
};

export async function generateSoaEmailHtml(
  data: SoaEmailData
): Promise<string> {
  const template = loadEmailTemplate(
    TEMPLATES_DIR,
    "TemplateOutstandingStatementOfAccount"
  );
  return await renderTemplate(template, {
    customerName: data.customerName,
    virtualAccount: data.virtualAccount,
    formattedDate: formatDateIndonesian(data.asAtDate),
    formattedDateEn: formatEnDate(data.asAtDate),
  });
}
