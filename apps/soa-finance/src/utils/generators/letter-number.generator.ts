import { ROMAN_MONTHS } from "../../constants";
import { getNextLetterSequence } from "../../database";

export async function generateLetterNumber(
  type: string,
  date: Date = new Date()
): Promise<string> {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  const seqNo = await getNextLetterSequence(type, year, month);

  const paddedSeq = seqNo.toString().padStart(3, "0");
  const romanMonth = ROMAN_MONTHS[month - 1];

  return `${paddedSeq}/FIN/SOA/RL${type}/${romanMonth}/${year}`;
}
