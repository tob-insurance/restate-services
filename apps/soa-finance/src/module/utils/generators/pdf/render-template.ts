import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderTemplate } from "../../template";
import { getSignature } from "./assets";

const TEMPLATES_DIR = join(__dirname, "../../email/templates/html");

export async function renderLiquidToHtml(
  templateName: string,
  data: Record<string, unknown>
): Promise<string> {
  const templatePath = join(TEMPLATES_DIR, `${templateName}.liquid`);
  const templateContent = readFileSync(templatePath, "utf-8");

  // Add signature to data
  const enrichedData = {
    ...data,
    ImgSign: getSignature(),
  };

  return await renderTemplate(templateContent, enrichedData);
}
