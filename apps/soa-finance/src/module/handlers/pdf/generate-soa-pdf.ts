import { generatePdfWithHeaderFooter } from "../../../infrastructure/gotenberg/gotenberg-client";
import { renderLiquidToHtml } from "../../utils/generators";
import { generateHeaderFooter } from "../../utils/generators/pdf/header-footer";

export async function generateSoaPdfHandler(params: {
  templateName: string;
  data: Record<string, unknown>;
  filename: string;
}): Promise<{ fileName: string; bytes: string; contentType: string }> {
  // 1. Render body HTML from template
  const html = await renderLiquidToHtml(params.templateName, params.data);

  // 2. Generate header and footer HTML
  const { headerHtml, footerHtml } = await generateHeaderFooter();

  // 3. Send to Gotenberg with header/footer
  const pdfBuffer = await generatePdfWithHeaderFooter(
    html,
    headerHtml,
    footerHtml,
    {
      marginTop: 1.5,
      marginBottom: 1,
      marginLeft: 0.5,
      marginRight: 0.5,
    }
  );

  return {
    fileName: `${params.filename}.pdf`,
    bytes: pdfBuffer.toString("base64"),
    contentType: "application/pdf",
  };
}
