import type { IStatementOfAccountModel } from "../../../module/utils/types";
import { transformSoaRow } from "./soa-transformer";

export async function* transformSoaStream(
  source: AsyncIterable<unknown[]>,
): AsyncGenerator<IStatementOfAccountModel, void, unknown> {
  for await (const row of source) {
    const model = transformSoaRow(row);
    if (model) {
      yield model;
    }
  }
}
