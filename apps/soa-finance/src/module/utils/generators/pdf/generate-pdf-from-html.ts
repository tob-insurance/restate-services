import type { Page } from "puppeteer";
import puppeteer from "puppeteer";
import { renderTemplate } from "../../core/template-engine";
import type { IReportOptions } from "../../types";

export async function generatePdfFromHtml(
  html: string,
  options?: IReportOptions
): Promise<Buffer> {
  const browser = await puppeteer.launch({
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });

  let page: Page | undefined;

  try {
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: options?.format ?? "A4",
      landscape: options?.landscape ?? false,
      margin: options?.margin ?? {
        top: "20mm",
        right: "20mm",
        bottom: "20mm",
        left: "20mm",
      },
      printBackground: true,
      displayHeaderFooter: options?.displayHeaderFooter ?? false,
      headerTemplate: options?.headerTemplate,
      footerTemplate: options?.footerTemplate,
    });

    return Buffer.from(pdfBuffer);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to generate PDF: ${errorMessage}`);
  } finally {
    if (page) {
      await page.close();
    }
  }
}

/**
 * Generate PDF from template and data
 */
export async function generatePdf(
  template: string,
  data: Record<string, unknown>,
  options?: IReportOptions
): Promise<Buffer> {
  const html = await renderTemplate(template, data);
  return generatePdfFromHtml(html, options);
}
