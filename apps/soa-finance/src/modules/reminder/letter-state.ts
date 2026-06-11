import type { ObjectContext } from "@restatedev/restate-sdk";
import { SENTINEL_ALL } from "../../constants/constants.js";
import { formatLetterNumber } from "../../utils/formatter/letter.formatter.js";
import { letterCounter } from "../soa/objects/letter-counter.js";
import type { LetterRecord } from "../soa/objects/state.js";
import { stateKeys } from "../soa/objects/state.js";
import type { SoaReminder } from "./types.js";

export type StoredLetterRecord = Omit<LetterRecord, "status"> & {
  status?: LetterRecord["status"];
};

export type LatestLetter = {
  type: string;
  sentDate: Date;
  letterNo: string;
} | null;

export interface AssignLetterRecordParams {
  ctx: ObjectContext;
  dateNow: Date;
  latestLetter: LatestLetter;
  letters: StoredLetterRecord[];
  reminder: SoaReminder;
  type: string;
}

interface GetNextLetterNumberParams {
  ctx: ObjectContext;
  dateNow: Date;
  type: string;
}

export const getLetterStateKey = (reminder: SoaReminder): string =>
  stateKeys.letters(reminder.timePeriod, reminder.officeId || SENTINEL_ALL);

export const getReminderLetters = async (
  ctx: ObjectContext,
  reminder: SoaReminder
): Promise<StoredLetterRecord[]> =>
  (await ctx.get<StoredLetterRecord[]>(getLetterStateKey(reminder))) ?? [];

export const getLatestSentLetter = (
  letters: StoredLetterRecord[]
): LatestLetter => {
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

export const upsertLetter = (
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

const getNextLetterNumber = async ({
  ctx,
  type,
  dateNow,
}: GetNextLetterNumberParams): Promise<string> => {
  const key = `${type}:${dateNow.getFullYear()}:${dateNow.getMonth() + 1}`;
  const seqNo = await ctx.objectClient(letterCounter, key).getNext();
  return formatLetterNumber(seqNo, type, dateNow);
};

export const assignLetterRecord = async ({
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

export const updateLetterStatus = async (
  ctx: ObjectContext,
  reminder: SoaReminder,
  pendingRecord: LetterRecord,
  status: LetterRecord["status"]
): Promise<void> => {
  const currentLetters = await getReminderLetters(ctx, reminder);
  ctx.set(
    getLetterStateKey(reminder),
    upsertLetter(currentLetters, { ...pendingRecord, status })
  );
};
