type PdfOptions = {
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  paperWidth?: number;
  paperHeight?: number;
  landscape?: boolean;
};

export async function generatePdf(
  htmlContent: string,
  options: PdfOptions = {}
): Promise<Buffer> {
  const GOTENBERG_URL = process.env.GOTENBERG_URL || "http://localhost:3000";
  try {
    const {
      marginTop = 1,
      marginBottom = 1,
      marginLeft = 0.5,
      marginRight = 0.5,
      paperWidth = 8.27,
      paperHeight = 11.7,
      landscape = false,
    } = options;

    // Create form data
    const formData = new FormData();

    // Add HTML file
    const htmlBlob = new Blob([htmlContent], { type: "text/html" });
    formData.append("files", htmlBlob, "index.html");

    // Add page properties
    formData.append("marginTop", marginTop.toString());
    formData.append("marginBottom", marginBottom.toString());
    formData.append("marginLeft", marginLeft.toString());
    formData.append("marginRight", marginRight.toString());
    formData.append("paperWidth", paperWidth.toString());
    formData.append("paperHeight", paperHeight.toString());

    if (landscape) {
      formData.append("landscape", "true");
    }

    // Call Gotenberg API
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
    console.error("Error generating PDF with Gotenberg:", error);
    throw new Error(
      `Failed to generate PDF: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
