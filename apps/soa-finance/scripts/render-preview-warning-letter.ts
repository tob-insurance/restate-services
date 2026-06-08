/**
 * Render a Warning Letter (Reminder Letter) PDF locally for visual preview.
 *
 * Usage (from apps/soa-finance):
 *   bun run scripts/render-preview-warning-letter.ts [outPath] [reminderCount]
 *
 * Reads GOTENBERG_URL from .env. Writes the PDF to /tmp/preview-warning-letter.pdf by default.
 * Pass reminderCount as 1, 2, or 3 (default: 1).
 *
 * On macOS you can rasterize it to inspect:
 *   sips -s format png /tmp/preview-warning-letter.pdf --out /tmp/preview-warning-letter.png
 */
import { writeFileSync } from "node:fs";
import { generatePdfWithHeaderFooter } from "../src/infrastructure/gotenberg/gotenberg-client.js";
import { createFooter } from "../src/modules/document-generation/html/footer.js";
import { createHeader } from "../src/modules/document-generation/html/header.js";
import {
  getFooter,
  getLogo,
  getSignature,
} from "../src/modules/document-generation/pdf-assets.js";
import { renderLiquidToHtml } from "../src/modules/document-generation/pdf-render.js";
import {
  computeDeadline,
  formatDateEnglish,
  formatDateIndonesian,
  formatMonthEnglish,
  formatMonthIndonesian,
} from "../src/utils/formatter/date.formatter.js";
import { formatThousands } from "../src/utils/formatter/number.formatter.js";

const outPath = process.argv[2] ?? "/tmp/preview-warning-letter.pdf";
const reminderCount = process.argv[3] ?? "1";

// Validate reminderCount
if (!["1", "2", "3"].includes(reminderCount)) {
  console.error("reminderCount must be 1, 2, or 3");
  process.exit(1);
}

// Sample data — adjust dates and values as needed
const toDate = new Date();
const letterNo = `WL/${toDate.getFullYear()}/${reminderCount.padStart(3, "0")}`;
const sampleTotalPremium = 150_000_000;

// Previous letter info (for 2nd and 3rd reminders)
const latestLetter =
  reminderCount === "1"
    ? null
    : {
        letterNo: `WL/${toDate.getFullYear()}/${(Number(reminderCount) - 1)
          .toString()
          .padStart(3, "0")}`,
        sentDate: new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
      };

const deadline = computeDeadline(reminderCount, toDate);

const templateData = {
  AsAtDateId: formatDateIndonesian(toDate),
  AsAtDateEn: formatDateEnglish(toDate),
  LetterNo: letterNo,
  Name: "PT FEDERAL INTERNATIONAL FINANCE",
  Branch: "Jakarta Pusat",
  ReminderCount: reminderCount,
  TotalPremium: formatThousands(sampleTotalPremium),
  OutstandingMonthId: formatMonthIndonesian(toDate),
  OutstandingMonthEn: formatMonthEnglish(toDate),
  LetterNoReff: latestLetter?.letterNo ?? null,
  SentDateId: latestLetter?.sentDate
    ? formatDateIndonesian(latestLetter.sentDate)
    : null,
  SentDateEn: latestLetter?.sentDate
    ? formatDateEnglish(latestLetter.sentDate)
    : null,
  DeadlineDateId: deadline?.deadlineId ?? "",
  DeadlineDateEn: deadline?.deadlineEn ?? "",
  VirtualNumber: "5300900000566",
  ImgSign: getSignature(),
};

const body = await renderLiquidToHtml(
  "TemplateReminderLetterSOA",
  templateData
);

const pdf = await generatePdfWithHeaderFooter(
  body,
  createHeader(getLogo()),
  createFooter(getFooter())
);

writeFileSync(outPath, pdf);
console.log(`wrote ${outPath} (${pdf.length} bytes)`);
console.log(`reminder count: ${reminderCount}`);
console.log(`letter no: ${letterNo}`);
