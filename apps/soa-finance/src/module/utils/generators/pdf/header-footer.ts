import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderTemplate } from "../../template";

import { getFooter, getHeader, getSignature } from "./assets";

const TEMPLATES_DIR = join(__dirname, "../../email/templates/html");

interface GotenbergPdfRequest {
  body: string;
  header?: string;
  footer?: string;
}

export async function generateHeaderFooter(): Promise<{
  headerHtml: string;
  footerHtml: string;
}> {
  const headerTemplate = readFileSync(
    join(TEMPLATES_DIR, "Header.html"),
    "utf-8"
  );
  const footerTemplate = readFileSync(
    join(TEMPLATES_DIR, "Footer.html"),
    "utf-8"
  );
  const headerHtml = await renderTemplate(headerTemplate, {
    headerLogo: getHeader(),
  });
  const footerHtml = await renderTemplate(footerTemplate, {
    footerLogo: getFooter(),
  });
  return { headerHtml, footerHtml };
}

export async function generatePdfWithHeaderFooter(
  bodyContent: string
): Promise<GotenbergPdfRequest> {
  const { headerHtml, footerHtml } = await generateHeaderFooter();
  return {
    body: bodyContent,
    header: headerHtml,
    footer: footerHtml,
  };
}
