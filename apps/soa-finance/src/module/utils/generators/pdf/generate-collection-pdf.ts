/**
 * Generate Collection PDF from HTML template
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT_TYPES } from "../../constants";
import { formatIndonesianDate } from "../../formatter";
import { renderTemplate } from "../../template";
import type { ISoaFileResult } from "../../types";
import { generatePdfFromHtml } from "./generate-pdf-from-html";

const TEMPLATES_DIR = join(__dirname, "../../email/templates/html");

function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, `${name}.html`), "utf-8");
}

export async function generateCollectionPdf(
  customerId: string,
  customerName: string,
  statementDate: string,
  virtualAccount: string
): Promise<ISoaFileResult> {
  const fileName = `Collection_Letter_${customerId}.pdf`;

  const template = loadTemplate("collectionPdf");
  const html = await renderTemplate(template, {
    customerId,
    customerName,
    statementDate,
    virtualAccount: virtualAccount || "-",
    letterDate: formatIndonesianDate(new Date()),
  });

  const buffer = await generatePdfFromHtml(html, {
    format: "A4",
    margin: {
      top: "20mm",
      right: "20mm",
      bottom: "20mm",
      left: "20mm",
    },
  });

  return {
    fileName,
    contentType: CONTENT_TYPES.PDF,
    bytes: buffer,
  };
}
