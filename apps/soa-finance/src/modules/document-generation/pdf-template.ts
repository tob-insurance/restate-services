import type { IAccount } from "../../types/customer.type.js";
import type { IStatementOfAccountModel } from "../../types/soa.type.js";
import {
  computeDeadline,
  formatDateEnglish,
  formatDateIndonesian,
  formatMonthEnglish,
  formatMonthIndonesian,
} from "../../utils/formatter/date.formatter.js";
import { formatThousands } from "../../utils/formatter/number.formatter.js";
import { getSignature } from "./pdf-assets";

type LatestLetterInfo = {
  letterNo: string;
  sentDate: Date;
} | null;

interface BuildPdfTemplateDataParams {
  branchName: string;
  customerData: IAccount;
  isReminder: boolean;
  latestLetter?: LatestLetterInfo;
  letterNo: string;
  reminderCount: string;
  soaData: IStatementOfAccountModel[];
  toDate: Date;
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
