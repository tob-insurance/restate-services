export interface EmailAttachment {
  contentBytes: string; // base64 for small files
  contentId?: string;
  contentType: string;
  isInline?: boolean;
  name: string;
  rawBytes?: Buffer; // raw buffer for large files (upload sessions)
  s3Key?: string; // S3 key — sender downloads and streams to Graph API
}

export interface UploadSession {
  expirationDateTime: string;
  nextExpectedRanges: string[];
  uploadUrl: string;
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
