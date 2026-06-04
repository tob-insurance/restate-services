/**
 * Render a SOA letter PDF locally for visual preview.
 *
 * Usage (from apps/soa-finance):
 *   bun run scripts/render-preview.ts [outPath]
 *
 * Reads GOTENBERG_URL from .env. Writes the PDF to /tmp/preview.pdf by default.
 * On macOS you can rasterize it to inspect:
 *   sips -s format png /tmp/preview.pdf --out /tmp/preview.png
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

const outPath = process.argv[2] ?? "/tmp/preview.pdf";

const body = await renderLiquidToHtml("TemplateOutstandingStatementOfAccount", {
  asAtDate: "4 Juni 2026",
  customerName: "PT FEDERAL INTERNATIONAL FINANCE",
  virtualAccount: "5300900000566",
  ImgSign: getSignature(),
});

const pdf = await generatePdfWithHeaderFooter(
  body,
  createHeader(getLogo()),
  createFooter(getFooter())
);

writeFileSync(outPath, pdf);
console.log(`wrote ${outPath} (${pdf.length} bytes)`);
