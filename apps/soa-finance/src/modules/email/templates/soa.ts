import { formatDateIndonesian } from "../../../utils/formatter/date.formatter.js";
import { formatEnDate } from "../../../utils/template/email-formatters";
import { renderEmail } from "../../../utils/template/engine";

export type SoaEmailData = {
  customerName: string;
  asAtDate: Date;
  virtualAccount: string;
};

export async function generateSoaEmailHtml(
  data: SoaEmailData
): Promise<string> {
  return await renderEmail("TemplateOutstandingStatementOfAccount", {
    customerName: data.customerName,
    virtualAccount: data.virtualAccount,
    formattedDate: formatDateIndonesian(data.asAtDate),
    formattedDateEn: formatEnDate(data.asAtDate),
  });
}
