import type { ObjectContext } from "@restatedev/restate-sdk";
import { SENTINEL_ALL } from "../../constants/constants.js";
import { isDevelopment } from "../../constants/environment.js";
import { getAccountEmails } from "../../infrastructure/database/queries/customer-query.js";
import type { IAccount } from "../../types/customer.type.js";
import type {
  ISoaItem,
  IStatementOfAccountModel,
} from "../../types/soa.type.js";
import { formatLetterNumber } from "../../utils/formatter/letter.formatter.js";
import { reminderPdfName } from "../../utils/formatter/naming.formatter.js";
import { generateAndUploadDocuments } from "../document-generation";
import { sendWithAttachments } from "../email/send-with-attachments";
import { getUnpaidSoaData } from "../payment/unpaid-data";
import { letterCounter } from "../soa/objects/letter-counter";
import type { LetterRecord } from "../soa/objects/state";
import { stateKeys } from "../soa/objects/state";
import type { IGenerateReminderResult, ISoaReminder } from "./types";

const DEV_TEST_EMAIL = process.env.SOA_DEV_TEST_EMAIL || "dev-test@tob-ins.com";

type GenerateReminderLetterParams = {
  ctx: ObjectContext;
  customer: IAccount;
  reminder: ISoaReminder;
  item: ISoaItem;
};

type StoredLetterRecord = Omit<LetterRecord, "status"> & {
  status?: LetterRecord["status"];
};

type LatestLetter = {
  type: string;
  sentDate: Date;
  letterNo: string;
} | null;

const getLetterStateKey = (reminder: ISoaReminder) =>
  stateKeys.letters(reminder.timePeriod, reminder.officeId || SENTINEL_ALL);

const getReminderLetters = async (
  ctx: ObjectContext,
  reminder: ISoaReminder
): Promise<StoredLetterRecord[]> =>
  (await ctx.get<StoredLetterRecord[]>(getLetterStateKey(reminder))) ?? [];

const getLatestSentLetter = (letters: StoredLetterRecord[]): LatestLetter => {
  const latest = letters
    .filter((letter) => !letter.status || letter.status === "sent")
    .reduce<StoredLetterRecord | null>((currentLatest, letter) => {
      if (!currentLatest) {
        return letter;
      }

      return new Date(letter.sentDate).getTime() >
        new Date(currentLatest.sentDate).getTime()
        ? letter
        : currentLatest;
    }, null);

  return latest
    ? {
        type: latest.type,
        sentDate: new Date(latest.sentDate),
        letterNo: latest.letterNo,
      }
    : null;
};

const upsertLetter = (
  letters: StoredLetterRecord[],
  letter: LetterRecord
): StoredLetterRecord[] => {
  const index = letters.findIndex(
    (existing) =>
      existing.type === letter.type && existing.letterNo === letter.letterNo
  );

  if (index === -1) {
    return [...letters, letter];
  }

  const updatedLetters = [...letters];
  updatedLetters[index] = letter;
  return updatedLetters;
};

const validateReminderType = (
  ctx: ObjectContext,
  customer: IAccount,
  item: ISoaItem,
  latestLetter: LatestLetter
): number | null => {
  const previousType = latestLetter
    ? Number.parseInt(latestLetter.type, 10)
    : -1;

  const expectedType = item.processingType - 1;

  if (item.processingType === 1) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: type is SOA but has existing reminders`
    );
    return null;
  }

  if (previousType >= expectedType) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: already sent type ${previousType}`
    );
    return null;
  }

  if (expectedType > 3) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: expected type exceeds max (3)`
    );
    return null;
  }

  const reminderCount = expectedType;
  ctx.console.log(
    `[Reminder] Processing type ${reminderCount} for ${customer.code}`
  );
  return reminderCount;
};

type CreateAndSendReminderParams = {
  ctx: ObjectContext;
  customer: IAccount;
  reminder: ISoaReminder;
  item: ISoaItem;
  unpaidItems: IStatementOfAccountModel[];
  latestLetter: LatestLetter;
  reminderCount: number;
  letters: StoredLetterRecord[];
};

type AssignLetterRecordParams = {
  ctx: ObjectContext;
  reminder: ISoaReminder;
  type: string;
  dateNow: Date;
  latestLetter: LatestLetter;
  letters: StoredLetterRecord[];
};

type GetNextLetterNumberParams = {
  ctx: ObjectContext;
  type: string;
  dateNow: Date;
};

const getNextLetterNumber = async ({
  ctx,
  type,
  dateNow,
}: GetNextLetterNumberParams): Promise<string> => {
  const key = `${type}:${dateNow.getFullYear()}:${dateNow.getMonth() + 1}`;
  const seqNo = await ctx.objectClient(letterCounter, key).getNext();
  return formatLetterNumber(seqNo, type, dateNow);
};

const assignLetterRecord = async ({
  ctx,
  reminder,
  type,
  dateNow,
  latestLetter,
  letters,
}: AssignLetterRecordParams): Promise<LetterRecord> => {
  const pendingLetter = letters.find(
    (letter) =>
      letter.type === type &&
      letter.status === "pending" &&
      letter.referenceLetterNo === latestLetter?.letterNo
  );

  const letterNo =
    pendingLetter?.letterNo ??
    (await getNextLetterNumber({ ctx, type, dateNow }));

  const pendingRecord: LetterRecord = {
    type,
    letterNo,
    referenceLetterNo: latestLetter?.letterNo,
    sentDate: dateNow.toISOString(),
    status: "pending",
  };

  ctx.set(getLetterStateKey(reminder), upsertLetter(letters, pendingRecord));
  return pendingRecord;
};

type GenerateUploadSendReminderParams = {
  ctx: ObjectContext;
  unpaidItems: IStatementOfAccountModel[];
  customer: IAccount;
  item: ISoaItem;
  reminderCount: number;
  letterNo: string;
  latestLetter: LatestLetter;
  type: string;
  branchName: string;
};

const generateUploadAndSendReminder = async ({
  ctx,
  unpaidItems,
  customer,
  item,
  reminderCount,
  letterNo,
  latestLetter,
  type,
  branchName,
}: GenerateUploadSendReminderParams): Promise<void> => {
  const dateNow = new Date(item.processingDate);
  const totalPremium = unpaidItems.reduce(
    (sum, soaItem) => sum + (soaItem.netPremiumIdr || 0),
    0
  );
  const pdfFileName = reminderPdfName(reminderCount);

  // Generate, upload to S3 (archival), and send email — all in one ctx.run
  // so binary data stays inside the callback and is not journaled
  await ctx.run(
    "generate-upload-send-reminder",
    { timeout: 180_000 },
    async () => {
      const files = await generateAndUploadDocuments({
        soaData: unpaidItems,
        customerData: customer,
        params: item,
        branchName,
        letterNo,
        latestLetter,
        pdfFileName,
      });

      await sendWithAttachments({
        customerData: customer,
        date: dateNow,
        isReminder: true,
        reminderType: type,
        letterNo,
        previousLetterNo: latestLetter?.letterNo,
        previousLetterDate: latestLetter?.sentDate,
        branch: branchName,
        totalPremium,
        excelFile: files.excelFile,
        pdfFile: files.pdfFile,
      });
    }
  );
};

const finalizeLetterSent = async (
  ctx: ObjectContext,
  reminder: ISoaReminder,
  pendingRecord: LetterRecord
): Promise<void> => {
  const currentLetters = await getReminderLetters(ctx, reminder);
  ctx.set(
    getLetterStateKey(reminder),
    upsertLetter(currentLetters, { ...pendingRecord, status: "sent" })
  );
};

const createAndSendReminder = async (
  params: CreateAndSendReminderParams
): Promise<IGenerateReminderResult> => {
  const {
    ctx,
    customer,
    reminder,
    item,
    unpaidItems,
    latestLetter,
    reminderCount,
    letters,
  } = params;
  const dateNow = new Date(item.processingDate);
  const type = reminderCount.toString();
  const branchName = unpaidItems.length > 0 ? unpaidItems[0].branch : "";

  // Phase 1: Assign letter record
  const pendingRecord = await assignLetterRecord({
    ctx,
    reminder,
    type,
    dateNow,
    latestLetter,
    letters,
  });

  // Phase 2: Generate, upload to S3 (archival), and send email (one ctx.run)
  await generateUploadAndSendReminder({
    ctx,
    unpaidItems,
    customer,
    item,
    reminderCount,
    letterNo: pendingRecord.letterNo,
    latestLetter,
    type,
    branchName,
  });

  // Phase 3: Finalize state
  await finalizeLetterSent(ctx, reminder, pendingRecord);

  return {
    sent: true,
    dcNotesPaid: [],
    letterNo: pendingRecord.letterNo,
    reason: "SENT",
  };
};

export const generateReminderLetter = async (
  params: GenerateReminderLetterParams
): Promise<IGenerateReminderResult | null> => {
  const { ctx, customer, reminder, item } = params;

  const letters = await getReminderLetters(ctx, reminder);
  const latestLetter = getLatestSentLetter(letters);
  const reminderCount = validateReminderType(ctx, customer, item, latestLetter);
  if (reminderCount === null) {
    return null;
  }

  const branchCode = reminder.officeId || SENTINEL_ALL;

  let toEmail: string;
  if (isDevelopment()) {
    // Development-only fallback recipient when SOA_DEV_TEST_EMAIL is not set.
    toEmail = customer.email || DEV_TEST_EMAIL;
  } else {
    const emails = await ctx.run(
      "get-account-emails",
      { timeout: 30_000 },
      () => getAccountEmails(customer.code, branchCode)
    );
    toEmail = emails.join(",");
  }

  if (!toEmail) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no email addresses found`
    );
    return null;
  }

  const unpaidData = await getUnpaidSoaData(ctx, customer, reminder);
  if (!unpaidData) {
    return null;
  }

  if (unpaidData.unpaidItems.length === 0) {
    return {
      sent: false,
      dcNotesPaid: unpaidData.dcNotesPaid,
      letterNo: null,
      reason: "ALL_PAID",
    };
  }

  const result = await createAndSendReminder({
    ctx,
    customer,
    reminder,
    item,
    unpaidItems: unpaidData.unpaidItems,
    latestLetter,
    reminderCount,
    letters,
  });

  return { ...result, dcNotesPaid: unpaidData.dcNotesPaid };
};
