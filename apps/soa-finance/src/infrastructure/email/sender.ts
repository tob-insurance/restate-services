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
    attachments?.map((att) => {
      const attachment: Record<string, unknown> = {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: att.name,
        contentType: att.contentType,
        contentBytes: att.contentBytes,
      };
      if (att.isInline) {
        attachment.isInline = true;
        attachment.contentId = att.contentId;
      }
      return attachment;
    }) ?? []
  );
}

const SHARED_MAILBOX =
  process.env.AZURE_SHARED_MAILBOX || "collection@tob-ins.com";

export async function sendEmail(message: IEmailMessage): Promise<boolean> {
  const initiatorEmail = process.env.AZURE_INITIATOR_EMAIL;
  if (!initiatorEmail) {
    throw new Error("AZURE_INITIATOR_EMAIL environment variable is required");
  }

  const client = getGraphClient();

  const mailBody = {
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
    await client.api(`/users/${initiatorEmail}/sendMail`).post(mailBody);
    console.log(
      `[Email] Sent to: ${message.to.join(", ")}, subject: ${message.subject}`
    );
    return true;
  } catch (error: unknown) {
    console.error("[Email] Failed to send:", error);
    throw error;
  }
}
