import type { ObjectContext } from "@restatedev/restate-sdk";
import { readSoaParquet } from "../../pipeline/lib";
import type { IAccount, IStatementOfAccountModel } from "../../types";
import type { DcNoteIndex } from "./objects/state";
import { stateKeys } from "./objects/state";

type GenerateSoaOptions = {
  ctx: ObjectContext;
  branchCode: string;
  customer: IAccount;
  classOfBusiness: string;
  dateNow: Date;
  processingType: number;
};

export const generateSoa = async (
  options: GenerateSoaOptions
): Promise<IStatementOfAccountModel[] | null> => {
  const { ctx, branchCode, customer, classOfBusiness, dateNow } = options;

  ctx.console.log(
    `[GenerateSOA] Started for ${customer.code}, Branch: ${branchCode}, COB: ${classOfBusiness}`
  );

  // ========== Get SOA Data (Parquet — unchanged, in ctx.run) ==========
  let soaList = await ctx.run(
    "read-parquet",
    async () => await readSoaParquet(customer.code, branchCode, dateNow)
  );

  if (soaList.length === 0) {
    ctx.console.log(`Skipping ${customer.code}: No SOA records found`);
    return null;
  }

  // Filter Aging (pure logic — no ctx.run needed)
  soaList = soaList.filter((soa) => soa.aging >= 60);

  if (soaList.length === 0) {
    ctx.console.log(`Skipping ${customer.code}: No aging records found`);
    return null;
  }

  // Filter already-processed DC notes using state
  const newSoaList = await filterAlreadyProcessedDcNotes(ctx, soaList);

  if (!newSoaList || newSoaList.length === 0) {
    ctx.console.log(
      `Skipping ${customer.code}: All DC notes already processed`
    );
    return null;
  }

  ctx.console.log(
    `[GenerateSOA] Data ready for ${customer.code}: ${newSoaList.length} records`
  );

  return newSoaList;
};

async function filterAlreadyProcessedDcNotes(
  ctx: ObjectContext,
  soaList: IStatementOfAccountModel[]
): Promise<IStatementOfAccountModel[] | null> {
  const dcNotesSet = new Set(
    soaList.flatMap((soa) => soa.debitAndCreditNoteNo?.split(",") || [])
  );
  const dcNotes = Array.from(dcNotesSet);

  const dcNoteIndex = await ctx.get<DcNoteIndex>(stateKeys.dcNoteIndex);
  const existingDcNotes = dcNoteIndex ? Object.keys(dcNoteIndex) : [];
  const existingSet = new Set(existingDcNotes.map((id) => id.toLowerCase()));

  const processedDcNotes = dcNotes.filter(
    (note) => !existingSet.has(note.toLowerCase())
  );

  if (processedDcNotes.length === 0) {
    return [];
  }

  const processedSet = new Set(processedDcNotes);
  return soaList.filter((soa) => processedSet.has(soa.debitAndCreditNoteNo));
}
