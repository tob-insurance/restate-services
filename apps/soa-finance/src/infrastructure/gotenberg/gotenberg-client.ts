import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { INFRASTRUCTURE_TIMEOUTS } from "../../constants/constants.js";
import logger from "../../utils/logger.js";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const GOTENBERG_5XX_REGEX = /Gotenberg API error \(5\d{2}\)/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      code === "ETIMEDOUT" ||
      code === "ECONNRESET" ||
      code === "ECONNREFUSED"
    ) {
      return true;
    }
    // 5xx Gotenberg API errors are retryable
    if (GOTENBERG_5XX_REGEX.test(error.message)) {
      return true;
    }
  }
  return false;
}

interface PdfOptions {
  landscape?: boolean;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  paperHeight?: number;
  paperWidth?: number;
  scale?: number;
}

export const PaperSizes = {
  A4: { width: 8.27, height: 11.7 },
  A5: { width: 5.83, height: 8.27 },
};

type PdfWithHeaderFooterOptions = PdfOptions & {
  headerHtml?: string;
  footerHtml?: string;
};

function streamToBuffer(stream: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function buildMultipartBody(
  parts: {
    name: string;
    value: string | Buffer;
    filename?: string;
    contentType?: string;
  }[]
): { body: Buffer; boundary: string } {
  const boundary = `----Gotenberg${Math.random().toString(36).slice(2)}`;
  const buffers: Buffer[] = [];

  for (const part of parts) {
    buffers.push(Buffer.from(`--${boundary}\r\n`));
    buffers.push(
      Buffer.from(`Content-Disposition: form-data; name="${part.name}"`)
    );
    if (part.filename) {
      buffers.push(Buffer.from(`; filename="${part.filename}"`));
    }
    buffers.push(Buffer.from("\r\n"));
    if (part.contentType) {
      buffers.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    }
    buffers.push(Buffer.from("\r\n"));
    buffers.push(Buffer.from(part.value));
    buffers.push(Buffer.from("\r\n"));
  }

  buffers.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(buffers), boundary };
}

export async function generatePdfWithHeaderFooter(
  htmlContent: string,
  headerHtml: string,
  footerHtml: string,
  options: PdfWithHeaderFooterOptions = {}
): Promise<Buffer> {
  const GOTENBERG_URL = process.env.GOTENBERG_URL;
  if (!GOTENBERG_URL) {
    throw new Error("GOTENBERG_URL environment variable is required");
  }

  try {
    const { body, boundary, url, requestFn } = preparePdfRequest(
      htmlContent,
      headerHtml,
      footerHtml,
      options,
      GOTENBERG_URL
    );

    return await executeWithRetry(url, requestFn, body, boundary);
  } catch (error: unknown) {
    handlePdfError(error);
    throw error; // unreachable, but TypeScript needs it
  }
}

function preparePdfRequest(
  htmlContent: string,
  headerHtml: string,
  footerHtml: string,
  options: PdfWithHeaderFooterOptions,
  gotenbergUrl: string
) {
  const {
    marginTop = 1,
    marginBottom = 0.7,
    marginLeft = 0.5,
    marginRight = 0.5,
    paperWidth = PaperSizes.A4.width,
    paperHeight = PaperSizes.A4.height,
    landscape = false,
    scale = 1,
  } = options;

  const parts: {
    name: string;
    value: string | Buffer;
    filename?: string;
    contentType?: string;
  }[] = [
    {
      name: "files",
      value: htmlContent,
      filename: "index.html",
      contentType: "text/html",
    },
    { name: "marginTop", value: marginTop.toString() },
    { name: "marginBottom", value: marginBottom.toString() },
    { name: "marginLeft", value: marginLeft.toString() },
    { name: "marginRight", value: marginRight.toString() },
    { name: "paperWidth", value: paperWidth.toString() },
    { name: "paperHeight", value: paperHeight.toString() },
    { name: "scale", value: scale.toString() },
  ];

  if (landscape) {
    parts.push({ name: "landscape", value: "true" });
  }

  if (headerHtml) {
    parts.push({
      name: "files",
      value: headerHtml,
      filename: "header.html",
      contentType: "text/html",
    });
  }
  if (footerHtml) {
    parts.push({
      name: "files",
      value: footerHtml,
      filename: "footer.html",
      contentType: "text/html",
    });
  }

  const { body, boundary } = buildMultipartBody(parts);
  const url = new URL(`${gotenbergUrl}/forms/chromium/convert/html`);
  const isHttps = url.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;

  return { body, boundary, url, requestFn };
}

async function executeWithRetry(
  url: URL,
  requestFn: typeof httpRequest,
  body: Buffer,
  boundary: string
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
      logger.warn(
        {
          component: "Gotenberg",
          attempt,
          maxRetries: MAX_RETRIES,
          backoffMs,
        },
        "Retrying PDF generation after backoff"
      );
      await sleep(backoffMs);
    }

    try {
      return await executePdfRequest(url, requestFn, body, boundary);
    } catch (error: unknown) {
      lastError = error;
      if (shouldRetryPdf(error, attempt)) {
        logger.warn(
          { component: "Gotenberg", err: error, attempt },
          "Gotenberg request failed, will retry"
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function executePdfRequest(
  url: URL,
  requestFn: typeof httpRequest,
  body: Buffer,
  boundary: string
): Promise<Buffer> {
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = requestFn(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length.toString(),
        },
        timeout: INFRASTRUCTURE_TIMEOUTS.GOTENBERG_PDF_MS,
      },
      resolve
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new DOMException("Request timed out", "AbortError"));
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });

  if (response.statusCode !== 200) {
    const errorText = await streamToBuffer(response);
    throw new Error(
      `Gotenberg API error (${response.statusCode}): ${errorText.toString()}`
    );
  }

  return await streamToBuffer(response);
}

function shouldRetryPdf(error: unknown, attempt: number): boolean {
  if (attempt >= MAX_RETRIES) {
    return false;
  }
  if (isRetryableError(error)) {
    return true;
  }
  if (error instanceof Error && GOTENBERG_5XX_REGEX.test(error.message)) {
    return true;
  }
  return false;
}

function handlePdfError(error: unknown): never {
  if (error instanceof DOMException && error.name === "AbortError") {
    logger.error(
      { component: "Gotenberg", err: error },
      "PDF generation timed out"
    );
    throw new Error("PDF generation timed out after 60 seconds", {
      cause: error,
    });
  }

  logger.error({ component: "Gotenberg", err: error }, "PDF generation failed");
  const errorMessage = error instanceof Error ? error.message : String(error);
  throw new Error(`Failed to generate PDF: ${errorMessage}`, {
    cause: error,
  });
}
