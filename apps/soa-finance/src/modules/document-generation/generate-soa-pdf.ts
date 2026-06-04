import { CONTENT_TYPES } from "../../constants/constants.js";
import { generatePdfWithHeaderFooter } from "../../infrastructure/gotenberg/gotenberg-client.js";
import { createFooter } from "./html/footer.js";
import { createHeader } from "./html/header.js";
import { getFooter, getLogo } from "./pdf-assets.js";
import { renderLiquidToHtml } from "./pdf-render.js";

export async function generateSoaPdfHandler(params: {
  templateName: string;
  data: Record<string, unknown>;
  filename: string;
}): Promise<{ fileName: string; bytes: Buffer; contentType: string }> {
  // 1. Render body HTML from template
  const html = await renderLiquidToHtml(params.templateName, params.data);

  // 2. Generate header and footer HTML
  const headerHtml = createHeader(getLogo());
  const footerHtml = createFooter(getFooter());

  // 3. Send to Gotenberg with header/footer
  const pdfBuffer = await generatePdfWithHeaderFooter(
    html,
    headerHtml,
    footerHtml
  );
  const fileName = params.filename.endsWith(".pdf")
    ? params.filename
    : `${params.filename}.pdf`;

  return {
    fileName,
    bytes: pdfBuffer,
    contentType: CONTENT_TYPES.PDF,
  };
}
