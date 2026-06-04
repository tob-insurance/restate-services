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

const body = await renderLiquidToHtml("TemplateOutstandingStatementOfAccount", {
  asAtDate: "4 Juni 2026",
  customerName: "PT FEDERAL INTERNATIONAL FINANCE",
  virtualAccount: "5300900000566",
  ImgSign: getSignature(),
});
// 1: no header, no footer
writeFileSync(
  "/tmp/d_none.pdf",
  await generatePdfWithHeaderFooter(body, "", "")
);
// 2: body + footer only
writeFileSync(
  "/tmp/d_footer.pdf",
  await generatePdfWithHeaderFooter(body, "", createFooter(getFooter()))
);
// 3: body + header only
writeFileSync(
  "/tmp/d_header.pdf",
  await generatePdfWithHeaderFooter(body, createHeader(getLogo()), "")
);
console.log("ok");
