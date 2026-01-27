export type IReminderEmailData = {
  customerName: string;
  asAtDate: Date;
  virtualAccount: string;
  letterNo: string;
  previousLetterNo?: string;
  previousLetterDate?: Date;
};
