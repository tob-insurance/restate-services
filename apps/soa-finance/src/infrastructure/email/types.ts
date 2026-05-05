export type IEmailAttachment = {
  name: string;
  contentType: string;
  contentBytes: string;
  isInline?: boolean;
  contentId?: string;
};

export type IEmailMessage = {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  attachments?: IEmailAttachment[];
};

export type ISendEmailResult = {
  sent: boolean;
  reason?: string;
};
