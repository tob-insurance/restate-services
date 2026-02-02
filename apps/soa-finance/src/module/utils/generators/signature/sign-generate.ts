import fs from "node:fs/promises";
import path from "node:path";

export async function getSignature() {
  const imgPath = path.resolve(__dirname, "../../asset/ttdClaudiaNoStamp.jpg");
  const buffer = await fs.readFile(imgPath);
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}
