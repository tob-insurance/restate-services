export interface EmailAttachment {
  contentBytes: string;
  contentId?: string;
  contentType: string;
  isInline?: boolean;
  name: string;
}

export interface EmailMessage {
  attachments?: EmailAttachment[];
  body: string;
  cc?: string[];
  subject: string;
  to: string[];
}

export interface SendEmailResult {
  reason?: string;
  sent: boolean;
}
