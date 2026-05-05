export type IReminderEmailData = {
  customerName: string;
  asAtDate: Date;
  virtualAccount: string;
  letterNo: string;
  previousLetterNo?: string;
  previousLetterDate?: Date;
  branch?: string;
  totalPremium?: number;
};

export type ISoaReminder = {
  id: string;
  customerCode: string;
  timePeriod: string;
  officeId: string;
};

export type IProcessReminder = {
  processed: boolean;
  remindersSent: number;
  dcNotesPaid: string[];
};

export type IGenerateReminderResult = {
  sent: boolean;
  dcNotesPaid: string[];
  letterNo?: string | null;
  reason?: "ALL_PAID" | "SENT" | "ERROR";
};
