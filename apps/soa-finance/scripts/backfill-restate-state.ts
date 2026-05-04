/**
 * Backfill script: Migrate existing Oracle SOA_REMINDER_* data
 * into Restate Virtual Object K/V state.
 *
 * Usage: bun run scripts/backfill-restate-state.ts
 *
 * Prerequisites:
 * - Restate server running (default: http://localhost:8080)
 * - ORACLE_URL environment variable set
 * - SoaCustomer and LetterCounter objects registered with Restate
 *
 * This script:
 * 1. Reads all reminders, details, and letters from Oracle
 * 2. Groups by customer code; translates Oracle UUIDs to composite keys
 * 3. Calls SoaCustomer.backfill handler for each customer
 * 4. Initializes LetterCounter from max letter sequence per type/year/month
 *
 * Safe to run multiple times — backfill handlers are idempotent.
 */

import { getOracleClient } from "../src/infrastructure/database/database.js";

const RESTATE_INGRESS = process.env.RESTATE_INGRESS ?? "http://localhost:8080";

type OracleReminder = {
  id: string;
  cmCode: string;
  timePeriod: string;
  officeId: string;
};

type OracleDetail = {
  dcNoteId: string;
  isPaid: string;
  reminderId: string;
};

type OracleLetter = {
  type: string;
  letterNo: string;
  sentDate: string;
  reminderId: string;
};

async function main() {
  const oracle = getOracleClient();

  console.log("Fetching reminders from Oracle...");
  const reminders = (
    (await oracle.executeQuery(
      `SELECT RAWTOHEX(ID) as "id", CM_CODE as "cmCode", TIME_PERIOD as "timePeriod", NVL(OFFICE_ID, 'ALL') as "officeId" FROM SOA_REMINDER ORDER BY CM_CODE`
    )) as { rows: OracleReminder[] }
  ).rows;

  console.log(`Found ${reminders.length} reminders`);

  // Map Oracle UUID → composite key
  const uuidToComposite = new Map<string, string>();
  for (const r of reminders) {
    uuidToComposite.set(r.id, `${r.timePeriod}:${r.officeId}`);
  }

  // Group by customer code
  const byCustomer = new Map<
    string,
    {
      headers: Array<{
        timePeriod: string;
        officeId: string;
        createdAt: string;
      }>;
      details: Record<string, Array<{ dcNoteId: string; isPaid: boolean }>>;
      letters: Record<
        string,
        Array<{ type: string; letterNo: string; sentDate: string }>
      >;
      dcNoteIndex: Record<string, string>;
    }
  >();

  for (const r of reminders) {
    if (!byCustomer.has(r.cmCode)) {
      byCustomer.set(r.cmCode, {
        headers: [],
        details: {},
        letters: {},
        dcNoteIndex: {},
      });
    }
    const entry = byCustomer.get(r.cmCode)!;
    const compositeId = uuidToComposite.get(r.id)!;

    entry.headers.push({
      timePeriod: r.timePeriod,
      officeId: r.officeId,
      createdAt: new Date().toISOString(),
    });

    // Fetch details
    const detailRows = (
      (await oracle.executeQuery(
        `SELECT DC_NOTE_ID as "dcNoteId", IS_PAID as "isPaid", RAWTOHEX(REMINDER_ID) as "reminderId" FROM SOA_REMINDER_DETAIL WHERE REMINDER_ID = hextoraw(:id)`,
        { id: r.id }
      )) as { rows: OracleDetail[] }
    ).rows;

    entry.details[compositeId] = detailRows.map((d) => ({
      dcNoteId: d.dcNoteId,
      isPaid: d.isPaid === "Y",
    }));

    for (const d of detailRows) {
      entry.dcNoteIndex[d.dcNoteId.toLowerCase()] = compositeId;
    }

    // Fetch letters
    const letterRows = (
      (await oracle.executeQuery(
        `SELECT TYPE as "type", LETTER_NO as "letterNo", SENT_DATE as "sentDate", RAWTOHEX(REMINDER_ID) as "reminderId" FROM SOA_REMINDER_LETTER WHERE REMINDER_ID = hextoraw(:id) ORDER BY SENT_DATE`,
        { id: r.id }
      )) as { rows: OracleLetter[] }
    ).rows;

    entry.letters[compositeId] = letterRows.map((l) => ({
      type: l.type,
      letterNo: l.letterNo,
      sentDate: new Date(l.sentDate).toISOString(),
    }));
  }

  console.log(`Grouped into ${byCustomer.size} customers`);

  // Call SoaCustomer.backfill for each customer
  let successCount = 0;
  let failCount = 0;

  for (const [cmCode, data] of byCustomer) {
    try {
      const response = await fetch(
        `${RESTATE_INGRESS}/SoaCustomer/${encodeURIComponent(cmCode)}/backfill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (response.ok) {
        const detailCount = Object.keys(data.dcNoteIndex).length;
        const letterCount = Object.values(data.letters).flat().length;
        console.log(
          `[OK] ${cmCode}: ${data.headers.length} reminders, ${detailCount} DC notes, ${letterCount} letters`
        );
        successCount++;
      } else {
        console.error(`[FAIL] ${cmCode}: HTTP ${response.status}`);
        failCount++;
      }
    } catch (err) {
      console.error(`[FAIL] ${cmCode}: ${err}`);
      failCount++;
    }
  }

  // Initialize LetterCounter from existing letter data
  const letterSeqPattern = /^(\d+)\/FIN\/SOA\/RL\d+\/\w+\/(\d{4})$/;
  const counterMap = new Map<string, number>();

  for (const data of byCustomer.values()) {
    for (const letterList of Object.values(data.letters)) {
      for (const l of letterList) {
        const match = l.letterNo.match(letterSeqPattern);
        if (match) {
          const seqNo = Number.parseInt(match[1], 10);
          const sentMonth = new Date(l.sentDate).getMonth() + 1;
          const fullKey = `${l.type}:${match[2]}:${sentMonth}`;
          if (!counterMap.has(fullKey) || seqNo > counterMap.get(fullKey)!) {
            counterMap.set(fullKey, seqNo);
          }
        }
      }
    }
  }

  console.log(`\nInitializing ${counterMap.size} LetterCounter keys...`);

  for (const [key, maxSeq] of counterMap) {
    try {
      const response = await fetch(
        `${RESTATE_INGRESS}/LetterCounter/${encodeURIComponent(key)}/backfill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ counter: maxSeq }),
        }
      );
      if (response.ok) {
        console.log(`[Counter] ${key}: initialized to ${maxSeq}`);
      } else {
        console.error(`[Counter] ${key}: HTTP ${response.status}`);
      }
    } catch (err) {
      console.error(`[Counter] ${key}: ${err}`);
    }
  }

  console.log(
    `\nDone: ${successCount} customers succeeded, ${failCount} failed`
  );
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
