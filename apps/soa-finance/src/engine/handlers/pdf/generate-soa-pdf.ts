import { generatePdfWithHeaderFooter } from "../../../infrastructure/gotenberg/gotenberg-client";
import { createFooter, createHeader } from "../../../utils/email";
import {
  getFooter,
  getHeader,
  renderLiquidToHtml,
} from "../../../utils/generators";

export async function generateSoaPdfHandler(params: {
  templateName: string;
  data: Record<string, unknown>;
  filename: string;
}): Promise<{ fileName: string; bytes: string; contentType: string }> {
  // 1. Render body HTML from template
  const html = await renderLiquidToHtml(params.templateName, params.data);

  // 2. Generate header and footer HTML
  const headerHtml = createHeader(getHeader());
  const footerHtml = createFooter(getFooter());

  // 3. Send to Gotenberg with header/footer
  const pdfBuffer = await generatePdfWithHeaderFooter(
    html,
    headerHtml,
    footerHtml,
  );

  return {
    fileName: `${params.filename}.pdf`,
    bytes: pdfBuffer.toString("base64"),
    contentType: "application/pdf",
  };
}
