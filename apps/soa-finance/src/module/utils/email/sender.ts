import type { IEmailAttachment, IEmailMessage } from "../types/email";
import { getGraphClient } from "./graph-client";

/**
 * Format email recipients for Graph API
 */
function formatRecipients(emails: string[]) {
  return emails.map((email) => ({ emailAddress: { address: email } }));
}

/**
 * Format attachments for Graph API
 */
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

/**
 * Get sender email from environment or use default
 */
function getSenderEmail(): string {
  return "gerardus.david@tob-ins.com";
}

/**
 * Send email using Microsoft Graph API
 */
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
    console.log(`Email sent to: ${message.to.join(", ")}`);
    return true;
  } catch (error: unknown) {
    console.error("Failed to send email:", error);
    throw error;
  }
}
