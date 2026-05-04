import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderTemplate } from "../../utils/template";
import { getSignature } from "./pdf-assets";

const TEMPLATES_DIR = join(__dirname, "../../assets/email/templates");
const templateCache = new Map<string, string>();

function loadTemplate(templateName: string): string {
  const cachedTemplate = templateCache.get(templateName);

  if (cachedTemplate !== undefined) {
    return cachedTemplate;
  }

  const templatePath = join(TEMPLATES_DIR, `${templateName}.liquid`);
  const templateContent = readFileSync(templatePath, "utf-8");
  templateCache.set(templateName, templateContent);

  return templateContent;
}

export async function renderLiquidToHtml(
  templateName: string,
  data: Record<string, unknown>
): Promise<string> {
  const templateContent = loadTemplate(templateName);

  const enrichedData = {
    ...data,
    ImgSign: data.ImgSign ?? getSignature(),
  };

  return await renderTemplate(templateContent, enrichedData);
}
