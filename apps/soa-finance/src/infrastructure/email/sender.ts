import { request as httpsRequest } from "node:https";
import { ClientSecretCredential } from "@azure/identity";
import { TerminalError } from "@restatedev/restate-sdk";
import {
  EMAIL_SEND_TIMEOUT_MS,
  UPLOAD_SESSION_TIMEOUT_MS,
} from "../../constants/timeouts.js";
import { isBufferFileData } from "../../types/soa.type.js";
import logger from "../../utils/logger.js";
import { downloadFile } from "../s3/index.js";
import type { EmailAttachment, EmailMessage, UploadSession } from "./types.js";

const MAX_ERROR_BODY = 500;
const MAX_ATTACHMENT_BYTES =
  Number(process.env.MAX_ATTACHMENT_BYTES) || 3 * 1024 * 1024; // 3MB default
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE) || 4 * 1024 * 1024; // 4MB default
const MAX_RETRIES = Number(process.env.EMAIL_MAX_RETRIES) || 3;
const BASE_BACKOFF_MS = Number(process.env.EMAIL_BASE_BACKOFF_MS) || 1000;

// ---------------------------------------------------------------------------
// Internal error type for HTTP responses from Graph API
// ---------------------------------------------------------------------------

class GraphHttpError extends Error {
  statusCode: number;
  responseBody: string;
  headers: Record<string, string>;

  constructor(
    statusCode: number,
    responseBody: string,
    headers: Record<string, string>
  ) {
    super(
      `Graph API HTTP ${statusCode}: ${responseBody.slice(0, MAX_ERROR_BODY)}`
    );
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.headers = headers;
  }
}

// ---------------------------------------------------------------------------
// Helpers (unchanged from original)
// ---------------------------------------------------------------------------

function formatRecipients(emails: string[]) {
  return emails.map((email) => ({ emailAddress: { address: email } }));
}

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

function parseRetryAfterMs(res: {
  headers?: Record<string, string>;
}): number | null {
  const value = res.headers?.["retry-after"] ?? res.headers?.["Retry-After"];
  if (!value) {
    return null;
  }
  const seconds = Number.parseInt(value, 10);
  if (Number.isNaN(seconds) || seconds <= 0) {
    return null;
  }
  return seconds * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(`Missing ${key}`);
  }
  return v;
}

async function getGraphToken(): Promise<string> {
  const credential = new ClientSecretCredential(
    getEnv("AZURE_TENANT_ID"),
    getEnv("AZURE_CLIENT_ID"),
    getEnv("AZURE_CLIENT_SECRET")
  );

  const token = await credential.getToken(
    "https://graph.microsoft.com/.default"
  );
  return token.token;
}

// ---------------------------------------------------------------------------
// Low-level HTTPS request helper
// ---------------------------------------------------------------------------

function makeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: Buffer,
  timeout: number = EMAIL_SEND_TIMEOUT_MS
): Promise<{
  body: string;
  statusCode: number;
  headers: Record<string, string>;
}> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method, headers, timeout }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          statusCode: res.statusCode ?? 0,
          headers: res.headers as Record<string, string>,
        })
      );
      res.on("error", reject);
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Retry wrapper — applies to draft/send operations, NOT chunk uploads
// ---------------------------------------------------------------------------

async function withRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      logger.info(
        { component: "Email", attempt, backoffMs, context },
        "Retrying after backoff"
      );
      await sleep(backoffMs);
    }

    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof GraphHttpError)) {
        throw error;
      }

      if (!isRetryableStatus(error.statusCode)) {
        throw new TerminalError(
          `Non-retryable error in ${context}: ${error.message}`
        );
      }

      lastError = error;
      await handleRateLimit(error, attempt);
      logRetryAttempt(error, attempt, context);
    }
  }
  throw lastError;
}

async function handleRateLimit(
  error: GraphHttpError,
  attempt: number
): Promise<void> {
  if (error.statusCode !== 429 || attempt >= MAX_RETRIES) {
    return;
  }
  const retryAfterMs = parseRetryAfterMs({ headers: error.headers });
  if (retryAfterMs === null) {
    return;
  }
  logger.info(
    { component: "Email", retryAfterMs },
    "Rate limited by Graph API, waiting for Retry-After"
  );
  await sleep(retryAfterMs);
}

function logRetryAttempt(
  error: GraphHttpError,
  attempt: number,
  context: string
): void {
  logger.warn(
    {
      component: "Email",
      statusCode: error.statusCode,
      attempt,
      context,
    },
    "Attempt failed, may retry"
  );
}

// ---------------------------------------------------------------------------
// Draft-based email flow helpers
// ---------------------------------------------------------------------------

async function createDraft(
  token: string,
  message: EmailMessage
): Promise<string> {
  const initiatorEmail = getEnv("AZURE_INITIATOR_EMAIL");
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(initiatorEmail)}/messages`;

  return await withRetry(async () => {
    const body = Buffer.from(
      JSON.stringify({
        subject: message.subject,
        body: { contentType: "HTML", content: message.body },
        toRecipients: formatRecipients(message.to),
        ccRecipients: message.cc ? formatRecipients(message.cc) : [],
      }),
      "utf8"
    );

    const response = await makeRequest(
      url,
      "POST",
      {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": body.length.toString(),
      },
      body
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new GraphHttpError(
        response.statusCode,
        response.body,
        response.headers
      );
    }

    const parsed = JSON.parse(response.body) as { id: string };
    logger.info(
      { component: "Email", messageId: parsed.id, subject: message.subject },
      "Created draft message"
    );
    return parsed.id;
  }, "createDraft");
}

async function addSmallAttachment(
  token: string,
  messageId: string,
  att: EmailAttachment
): Promise<void> {
  const initiatorEmail = getEnv("AZURE_INITIATOR_EMAIL");
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(initiatorEmail)}/messages/${messageId}/attachments`;

  return await withRetry(async () => {
    const body = Buffer.from(
      JSON.stringify({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: att.name,
        contentType: att.contentType,
        contentBytes: att.contentBytes,
        isInline: att.isInline ?? false,
        contentId: att.contentId,
      }),
      "utf8"
    );

    const response = await makeRequest(
      url,
      "POST",
      {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": body.length.toString(),
      },
      body
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new GraphHttpError(
        response.statusCode,
        response.body,
        response.headers
      );
    }

    logger.info(
      { component: "Email", attachmentName: att.name },
      "Added small attachment"
    );
  }, "addSmallAttachment");
}

async function createUploadSession(
  token: string,
  messageId: string,
  name: string,
  size: number
): Promise<UploadSession> {
  const initiatorEmail = getEnv("AZURE_INITIATOR_EMAIL");
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(initiatorEmail)}/messages/${messageId}/attachments/createUploadSession`;

  return await withRetry(async () => {
    const body = Buffer.from(
      JSON.stringify({
        AttachmentItem: {
          attachmentType: "file",
          name,
          size,
        },
      }),
      "utf8"
    );

    const response = await makeRequest(
      url,
      "POST",
      {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": body.length.toString(),
      },
      body
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new GraphHttpError(
        response.statusCode,
        response.body,
        response.headers
      );
    }

    const parsed = JSON.parse(response.body) as UploadSession;
    logger.info(
      {
        component: "Email",
        attachmentName: name,
        expirationDateTime: parsed.expirationDateTime,
      },
      "Created upload session"
    );
    return parsed;
  }, "createUploadSession");
}

async function uploadChunk(
  uploadUrl: string,
  chunk: Buffer,
  contentRange: string
): Promise<{ nextExpectedRanges: string[] }> {
  const response = await makeRequest(
    uploadUrl,
    "PUT",
    {
      "Content-Type": "application/octet-stream",
      "Content-Length": chunk.length.toString(),
      "Content-Range": contentRange,
    },
    chunk,
    UPLOAD_SESSION_TIMEOUT_MS
  );

  // Final chunk returns 201 with Location header (no body)
  if (response.statusCode === 201) {
    return { nextExpectedRanges: [] };
  }

  // Intermediate chunks return 200 with nextExpectedRanges
  if (response.statusCode >= 200 && response.statusCode < 300) {
    const parsed = JSON.parse(response.body) as {
      nextExpectedRanges: string[];
    };
    return parsed;
  }

  throw new GraphHttpError(
    response.statusCode,
    response.body,
    response.headers
  );
}

async function uploadLargeAttachment(
  token: string,
  messageId: string,
  att: EmailAttachment,
  bytes: Buffer
): Promise<void> {
  const session = await createUploadSession(
    token,
    messageId,
    att.name,
    bytes.length
  );

  let offset = 0;
  while (offset < bytes.length) {
    const end = Math.min(offset + CHUNK_SIZE, bytes.length);
    const chunk = bytes.subarray(offset, end);
    const contentRange = `bytes ${offset}-${end - 1}/${bytes.length}`;

    const percent = Math.round((end / bytes.length) * 100);
    logger.info(
      {
        component: "Email",
        attachmentName: att.name,
        offset,
        end,
        total: bytes.length,
        percent,
      },
      `Uploading chunk (${percent}%)`
    );

    const result = await uploadChunk(session.uploadUrl, chunk, contentRange);

    // Update offset from nextExpectedRanges if available
    if (result.nextExpectedRanges?.length > 0) {
      offset = Number.parseInt(result.nextExpectedRanges[0], 10);
    } else {
      offset = end;
    }
  }

  logger.info(
    { component: "Email", attachmentName: att.name, totalBytes: bytes.length },
    "Completed large attachment upload"
  );
}

async function sendDraft(token: string, messageId: string): Promise<void> {
  const initiatorEmail = getEnv("AZURE_INITIATOR_EMAIL");
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(initiatorEmail)}/messages/${messageId}/send`;

  return await withRetry(async () => {
    const response = await makeRequest(url, "POST", {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Length": "0",
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new GraphHttpError(
        response.statusCode,
        response.body,
        response.headers
      );
    }

    logger.info({ component: "Email", messageId }, "Sent draft message");
  }, "sendDraft");
}

// ---------------------------------------------------------------------------
// Delete draft on failure (cleanup orphaned drafts)
// ---------------------------------------------------------------------------

async function deleteDraft(token: string, messageId: string): Promise<void> {
  const initiatorEmail = getEnv("AZURE_INITIATOR_EMAIL");
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(initiatorEmail)}/messages/${messageId}`;

  try {
    await makeRequest(url, "DELETE", {
      Authorization: `Bearer ${token}`,
    });
    logger.info({ component: "Email", messageId }, "Deleted orphaned draft");
  } catch (error) {
    logger.warn(
      { component: "Email", messageId, err: error },
      "Failed to delete orphaned draft (may already be gone)"
    );
  }
}

// ---------------------------------------------------------------------------
// Public API — signature unchanged
// ---------------------------------------------------------------------------

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const token = await getGraphToken();

  // Step 1: Create draft
  const messageId = await createDraft(token, message);

  try {
    // Step 2: Add attachments in parallel (small via direct POST, large via upload session)
    const attachmentPromises = (message.attachments ?? []).map(async (att) => {
      let bytes: Buffer;

      if (att.s3Key) {
        // S3-based: download from S3
        const fileData = await downloadFile(att.s3Key);
        if (!isBufferFileData(fileData)) {
          throw new Error(
            `S3 download returned S3FileData instead of BufferFileData for key: ${att.s3Key}`
          );
        }
        bytes = fileData.bytes;
      } else if (att.rawBytes) {
        bytes = att.rawBytes;
      } else {
        bytes = Buffer.from(att.contentBytes, "base64");
      }

      if (bytes.length >= MAX_ATTACHMENT_BYTES) {
        await uploadLargeAttachment(token, messageId, att, bytes);
      } else {
        await addSmallAttachment(token, messageId, att);
      }
    });

    await Promise.all(attachmentPromises);

    // Step 3: Send draft
    await sendDraft(token, messageId);

    logger.info(
      { component: "Email", subject: message.subject, to: message.to },
      "Sent email"
    );
    return true;
  } catch (error) {
    // Cleanup: delete the draft if attachment upload or send fails
    await deleteDraft(token, messageId);
    throw error;
  }
}
