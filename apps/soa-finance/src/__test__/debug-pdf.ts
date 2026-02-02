import { writeFileSync } from "node:fs";
import { generatePdf } from "../infrastructure/gotenberg/gotenberg-client";
import { getSignature } from "../module/utils/generators";
import { renderLiquidToHtml } from "../module/utils/generators/pdf/render-template";

// Load environment variables (ensure GOTENBERG_URL is set)
process.env.GOTENBERG_URL = "http://localhost:3000";

async function testPdf() {
  console.log("Testing PDF Generation...");

  const templateName = "TemplateOutstandingStatementOfAccount";
  const testData = {
    asAtDate: Math.floor(Date.now() / 1000),
    customerName: "DEBUG TEST CUSTOMER",
    virtualAccount: "1234567890",
    signature: await getSignature(),
  };

  try {
    console.log("1. Rendering HTML...");
    const html = await renderLiquidToHtml(templateName, testData);

    // Opsional: Simpan HTML untuk debugging
    // writeFileSync("debug.html", html);

    console.log("2. Converting to PDF via Gotenberg...");
    const pdfBuffer = await generatePdf(html, {
      marginTop: 0.5,
      marginBottom: 0.5,
      marginLeft: 0.5,
      marginRight: 0.5,
    });

    const outputPath = "test_soa_output.pdf";
    writeFileSync(outputPath, pdfBuffer);
    console.log(`Success! PDF saved to: ${outputPath}`);
  } catch (error) {
    console.error("PDF Test Failed:", error);
  }
}

testPdf();
