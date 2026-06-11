export interface ReminderEmailData {
  asAtDate: Date;
  branch?: string;
  customerName: string;
  letterNo: string;
  previousLetterDate?: Date;
  previousLetterNo?: string;
  totalPremium?: number;
  virtualAccount: string;
}

export interface SoaReminder {
  customerCode: string;
  id: string;
  officeId: string;
  timePeriod: string;
}

export interface ProcessReminder {
  processed: boolean;
  remindersSent: number;
}

export interface GenerateReminderResult {
  letterNo?: string | null;
  reason?: "ALL_PAID" | "SENT" | "ERROR";
  sent: boolean;
}
