import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { INFRASTRUCTURE_TIMEOUTS } from "../../constants";

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

    const url = new URL(`${GOTENBERG_URL}/forms/chromium/convert/html`);
    const isHttps = url.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;

    const proxyUrl = process.env.HTTPS_PROXY;
    const agent =
      proxyUrl && isHttps ? new HttpsProxyAgent(proxyUrl) : undefined;

    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = requestFn(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": body.length.toString(),
          },
          agent,
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
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      console.error("[Gotenberg] PDF generation timed out");
      throw new Error("PDF generation timed out after 60 seconds");
    }

    console.error("[Gotenberg] PDF generation failed:", error);
    throw new Error(
      `Failed to generate PDF: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
