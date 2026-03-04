/**
 * Email Sender using Microsoft Graph API
 */

import { getGraphClient } from "./client";
import type { IEmailAttachment, IEmailMessage } from "./types";

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

function getSenderEmail(): string {
  return process.env.SENDER_EMAIL || "gerardus.david@tob-ins.com";
}

export async function sendEmail(message: IEmailMessage): Promise<boolean> {
  const client = getGraphClient();
  const senderEmail = getSenderEmail();

  const mailBody = {
    message: {
      subject: message.subject,
      body: { contentType: "HTML", content: message.body },
      from: { emailAddress: { address: senderEmail } },
      toRecipients: formatRecipients(message.to),
      ccRecipients: message.cc ? formatRecipients(message.cc) : [],
      attachments: formatAttachments(message.attachments),
    },
    saveToSentItems: true,
  };

  try {
    await client.api(`/users/${senderEmail}/sendMail`).post(mailBody);
    console.log(
      `[Email] Sent to: ${message.to.join(", ")}, subject: ${message.subject}`
    );
    return true;
  } catch (error: unknown) {
    console.error("[Email] Failed to send:", error);
    throw error;
  }
}
