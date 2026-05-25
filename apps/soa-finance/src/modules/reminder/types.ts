export interface IReminderEmailData {
  asAtDate: Date;
  branch?: string;
  customerName: string;
  letterNo: string;
  previousLetterDate?: Date;
  previousLetterNo?: string;
  totalPremium?: number;
  virtualAccount: string;
}

export interface ISoaReminder {
  customerCode: string;
  id: string;
  officeId: string;
  timePeriod: string;
}

export interface IProcessReminder {
  dcNotesPaid: string[];
  processed: boolean;
  remindersSent: number;
}

export interface IGenerateReminderResult {
  dcNotesPaid: string[];
  letterNo?: string | null;
  reason?: "ALL_PAID" | "SENT" | "ERROR";
  sent: boolean;
}
