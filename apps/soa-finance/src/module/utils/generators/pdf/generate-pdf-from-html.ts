/**
 * Generate PDF from HTML using Puppeteer
 */

import type { Page } from "puppeteer";
import puppeteer from "puppeteer";
import { renderTemplate } from "../../template";
import type { IReportOptions } from "../../types";

export async function generatePdfFromHtml(
  html: string,
  options?: IReportOptions
): Promise<Buffer> {
  const browser = await puppeteer.launch({
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", // Menggunakan /tmp daripada shared memory
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process", // Lebih hemat RAM untuk rendering PDF tunggal
      "--disable-gpu",
    ],
  });

  let page: Page | undefined;

  try {
    page = await browser.newPage();

    // Set longer timeout for safety
    await page.setDefaultNavigationTimeout(90_000);

    // Use domcontentloaded since our HTML has no external resources
    // This is much faster than networkidle0/networkidle2
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

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
    if (browser) {
      await browser.close();
    }
  }
}

export async function generatePdf(
  template: string,
  data: Record<string, unknown>,
  options?: IReportOptions
): Promise<Buffer> {
  const html = await renderTemplate(template, data);
  return generatePdfFromHtml(html, options);
}
