import { request as httpsRequest } from "node:https";
import { ClientSecretCredential } from "@azure/identity";
import { EMAIL_SEND_TIMEOUT_MS } from "../../constants/timeouts.js";
import { EMAIL_CONFIG } from "../../utils/config/emails.js";
import logger from "../../utils/logger.js";
import type { EmailAttachment, EmailMessage } from "./types.js";

interface GraphSendMailBody {
  message: {
    subject: string;
    body: { contentType: string; content: string };
    from: { emailAddress: { address: string } };
    toRecipients: { emailAddress: { address: string } }[];
    ccRecipients: { emailAddress: { address: string } }[];
    attachments: {
      "@odata.type": string;
      name: string;
      contentType: string;
      contentBytes: string;
    }[];
  };
  saveToSentItems: boolean;
}

const SHARED_MAILBOX = EMAIL_CONFIG.SHARED_MAILBOX;
const MAX_ERROR_BODY = 500;

function formatRecipients(emails: string[]) {
  return emails.map((email) => ({ emailAddress: { address: email } }));
}

function formatAttachments(attachments?: EmailAttachment[]) {
  return (
    attachments?.map((att) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: att.name,
      contentType: att.contentType,
      contentBytes: att.contentBytes,
      isInline: att.isInline ?? false,
      contentId: att.contentId,
    })) ?? []
  );
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

function bodyToBuffer(body: GraphSendMailBody): Buffer {
  return Buffer.from(JSON.stringify(body), "utf8");
}

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const initiatorEmail = process.env.AZURE_INITIATOR_EMAIL;
  if (!initiatorEmail) {
    throw new Error("AZURE_INITIATOR_EMAIL environment variable is required");
  }

  const mailBody: GraphSendMailBody = {
    message: {
      subject: message.subject,
      body: { contentType: "HTML", content: message.body },
      from: { emailAddress: { address: SHARED_MAILBOX } },
      toRecipients: formatRecipients(message.to),
      ccRecipients: message.cc ? formatRecipients(message.cc) : [],
      attachments: formatAttachments(message.attachments),
    },
    saveToSentItems: false,
  };

  try {
    const [token, body] = await Promise.all([
      getGraphToken(),
      bodyToBuffer(mailBody),
    ]);

    const response = await new Promise<{ body: string; statusCode: number }>(
      (resolve, reject) => {
        const req = httpsRequest(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(initiatorEmail)}/sendMail`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "Content-Length": body.length.toString(),
            },
            timeout: EMAIL_SEND_TIMEOUT_MS,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () =>
              resolve({
                body: Buffer.concat(chunks).toString("utf8"),
                statusCode: res.statusCode ?? 0,
              })
            );
            res.on("error", reject);
          }
        );
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Request timed out"));
        });
        req.on("error", reject);
        req.write(body);
        req.end();
      }
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `Email send failed with HTTP ${response.statusCode}: ${response.body.slice(0, MAX_ERROR_BODY)}`
      );
    }

    logger.info(
      { component: "Email", subject: message.subject, to: message.to },
      "Sent email"
    );
    return true;
  } catch (error: unknown) {
    logger.error({ component: "Email", err: error }, "Failed to send");
    throw error;
  }
}
