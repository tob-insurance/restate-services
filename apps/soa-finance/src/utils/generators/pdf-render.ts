import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderTemplate } from "../template";
import { getSignature } from "./pdf-assets";

const TEMPLATES_DIR = join(__dirname, "../../assets/email/templates");

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
