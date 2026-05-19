import type { IStatementOfAccountModel } from "../../types";
import { createTransformCounters, transformSoaRow } from "./soa-transformer";

export async function* transformSoaStream(
  source: AsyncIterable<unknown[]>
): AsyncGenerator<IStatementOfAccountModel, void, unknown> {
  const counters = createTransformCounters();

  for await (const row of source) {
    let model: IStatementOfAccountModel | null;

    try {
      model = transformSoaRow(row, counters);
    } catch (error) {
      counters.errored += 1;
      console.error("[SOA Transform] Failed to transform row", error);
      continue;
    }

    if (model) {
      yield model;
    }
  }

  console.log("[SOA Transform] Summary", {
    received: counters.received,
    emitted: counters.emitted,
    droppedShortRow: counters.droppedShortRow,
    droppedZeroPremium: counters.droppedZeroPremium,
    errored: counters.errored,
  });
}
