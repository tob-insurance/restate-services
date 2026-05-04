import { SCHEDULE_CONFIG } from "../../constants/schedule";
import type { IAccount, IStatementOfAccountModel } from "../../types";
import {
  formatDateEnglish,
  formatDateEnglishMonthFirst,
  formatDateIndonesian,
  formatMonthEnglish,
  formatMonthIndonesian,
  formatThousands,
} from "../../utils/formatter";
import { getSignature } from "./pdf-assets";

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

function computeDeadline(
  reminderCount: string,
  asAtDate: Date
): { deadlineId: string; deadlineEn: string } | null {
  const soaType = Number(reminderCount) + 1;
  const schedule = SCHEDULE_CONFIG.find((s) => s.soaType === soaType);
  const graceDays = schedule?.graceDays ?? 0;
  if (graceDays === 0) {
    return null;
  }
  const deadline = new Date(asAtDate);
  deadline.setDate(deadline.getDate() + graceDays);
  return {
    deadlineId: formatDateIndonesian(deadline),
    deadlineEn: formatDateEnglishMonthFirst(deadline),
  };
}

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

    const deadline = computeDeadline(reminderCount, toDate);

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
      DeadlineDateId: deadline?.deadlineId ?? "",
      DeadlineDateEn: deadline?.deadlineEn ?? "",
      VirtualNumber: customerData.virtualAccount,
      ImgSign: await getSignature(),
    };
  }

  return {
    asAtDate: formatDateIndonesian(toDate),
    customerName: customerData.fullName,
    virtualAccount: customerData.virtualAccount,
    ImgSign: await getSignature(),
  };
}
