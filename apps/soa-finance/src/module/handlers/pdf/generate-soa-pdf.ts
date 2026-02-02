import { generatePdf } from "../../../infrastructure/gotenberg/gotenberg-client";
import { renderLiquidToHtml } from "../../utils/generators/pdf/render-template";

export async function generateSoaPdfHandler(params: {
  templateName: string;
  data: Record<string, unknown>;
  filename: string;
}): Promise<{ fileName: string; bytes: string; contentType: string }> {
  const html = await renderLiquidToHtml(params.templateName, params.data);

  // 2. send to Gotenberg
  const pdfBuffer = await generatePdf(html, {
    marginTop: 0.5,
    marginBottom: 0.5,
    marginLeft: 0.5,
    marginRight: 0.5,
  });

  return {
    fileName: `${params.filename}.pdf`,
    bytes: pdfBuffer.toString("base64"),
    contentType: "application/pdf",
  };
}
