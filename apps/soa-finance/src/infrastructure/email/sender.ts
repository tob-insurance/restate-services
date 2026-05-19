import { request as httpsRequest } from "node:https";
import { ClientSecretCredential } from "@azure/identity";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { IEmailAttachment, IEmailMessage } from "./types";

type GraphSendMailBody = {
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
};

const SHARED_MAILBOX =
  process.env.AZURE_SHARED_MAILBOX || "collection@tob-ins.com";

function formatRecipients(emails: string[]) {
  return emails.map((email) => ({ emailAddress: { address: email } }));
}

function formatAttachments(attachments?: IEmailAttachment[]) {
  return (
    attachments?.map((att) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: att.name,
      contentType: att.contentType,
      contentBytes: att.contentBytes,
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

export async function sendEmail(message: IEmailMessage): Promise<boolean> {
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

    const proxyUrl = process.env.HTTPS_PROXY;
    const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

    const _response = await new Promise<Buffer>((resolve, reject) => {
      const req = httpsRequest(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(initiatorEmail)}/sendMail`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Content-Length": body.length.toString(),
          },
          agent,
          timeout: 30_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
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
    });

    console.log(
      `[Email] Sent to: ${message.to.join(", ")}, subject: ${message.subject}`
    );
    return true;
  } catch (error: unknown) {
    console.error("[Email] Failed to send:", error);
    throw error;
  }
}
