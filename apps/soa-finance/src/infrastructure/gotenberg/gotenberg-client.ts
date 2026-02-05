type PdfOptions = {
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  paperWidth?: number;
  paperHeight?: number;
  landscape?: boolean;
  scale?: number;
};

export const PaperSizes = {
  A4: { width: 8.27, height: 11.7 },
  A5: { width: 5.83, height: 8.27 },
};

type PdfWithHeaderFooterOptions = PdfOptions & {
  headerHtml?: string;
  footerHtml?: string;
};

export async function generatePdfWithHeaderFooter(
  htmlContent: string,
  headerHtml: string,
  footerHtml: string,
  options: PdfWithHeaderFooterOptions = {}
): Promise<Buffer> {
  const GOTENBERG_URL = process.env.GOTENBERG_URL || "http://localhost:3000";

  try {
    const {
      marginTop = 1,
      marginBottom = 0.5,
      marginLeft = 0.5,
      marginRight = 0.5,
      paperWidth = PaperSizes.A4.width,
      paperHeight = PaperSizes.A4.height,
      landscape = false,
      scale = 1,
    } = options;

    const formData = new FormData();

    // Add main HTML file (body)
    const htmlBlob = new Blob([htmlContent], { type: "text/html" });
    formData.append("files", htmlBlob, "index.html");

    // Add header HTML file
    if (headerHtml) {
      const headerBlob = new Blob([headerHtml], { type: "text/html" });
      formData.append("files", headerBlob, "header.html");
    }

    // Add footer HTML file
    if (footerHtml) {
      const footerBlob = new Blob([footerHtml], { type: "text/html" });
      formData.append("files", footerBlob, "footer.html");
    }

    // Add page properties
    formData.append("marginTop", marginTop.toString());
    formData.append("marginBottom", marginBottom.toString());
    formData.append("marginLeft", marginLeft.toString());
    formData.append("marginRight", marginRight.toString());
    formData.append("paperWidth", paperWidth.toString());
    formData.append("paperHeight", paperHeight.toString());
    formData.append("scale", scale.toString());

    if (landscape) {
      formData.append("landscape", "true");
    }

    const response = await fetch(
      `${GOTENBERG_URL}/forms/chromium/convert/html`,
      {
        method: "POST",
        body: formData,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gotenberg API error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("Error generating PDF with header/footer:", error);
    throw new Error(
      `Failed to generate PDF: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
