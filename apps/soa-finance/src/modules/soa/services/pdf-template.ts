import type { IAccount, IStatementOfAccountModel } from "../../../types";
import {
  formatDateEnglish,
  formatDateIndonesian,
  formatMonthEnglish,
  formatMonthIndonesian,
  formatThousands,
} from "../../../utils/formatter";
import { getSignature } from "../../reminder/pdf-assets";

type LatestLetterInfo = {
  letterNo: string;
  sentDate: Date;
} | null;

type BuildPdfTemplateDataParams = {
  isReminder: boolean;
  toDate: Date;
  customerData: IAccount;
  branchName: string;
  soaData: IStatementOfAccountModel[];
  letterNo: string;
  reminderCount: string;
  latestLetter?: LatestLetterInfo;
};

export async function buildPdfTemplateData(
  params: BuildPdfTemplateDataParams
): Promise<Record<string, unknown>> {
  const {
    isReminder,
    toDate,
    customerData,
    branchName,
    soaData,
    letterNo,
    reminderCount,
    latestLetter,
  } = params;

  if (isReminder) {
    const totalPremiumVal = soaData.reduce(
      (acc: number, item: IStatementOfAccountModel) =>
        acc + (item.netPremiumIdr || 0),
      0
    );

    return {
      AsAtDateId: formatDateIndonesian(toDate),
      AsAtDateEn: formatDateEnglish(toDate),
      LetterNo: letterNo,
      Name: customerData.fullName,
      Branch: branchName,
      ReminderCount: reminderCount,
      TotalPremium: formatThousands(totalPremiumVal),
      OutstandingMonthId: formatMonthIndonesian(toDate),
      OutstandingMonthEn: formatMonthEnglish(toDate),
      LetterNoReff: latestLetter?.letterNo ?? null,
      SentDateId: latestLetter?.sentDate
        ? formatDateIndonesian(latestLetter.sentDate)
        : null,
      SentDateEn: latestLetter?.sentDate
        ? formatDateEnglish(latestLetter.sentDate)
        : null,
      VirtualNumber: customerData.virtualAccount,
      ImgSign: await getSignature(),
    };
  }

  return {
    asAtDate: formatDateIndonesian(toDate),
    customerName: customerData.fullName,
    virtualAccount: customerData.virtualAccount,
    signature: await getSignature(),
  };
}
