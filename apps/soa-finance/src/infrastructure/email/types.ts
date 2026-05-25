export interface IEmailAttachment {
  contentBytes: string;
  contentId?: string;
  contentType: string;
  isInline?: boolean;
  name: string;
}

export interface IEmailMessage {
  attachments?: IEmailAttachment[];
  body: string;
  cc?: string[];
  subject: string;
  to: string[];
}

export interface ISendEmailResult {
  reason?: string;
  sent: boolean;
}
