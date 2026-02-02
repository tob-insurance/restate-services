import fs from "node:fs/promises";
import path from "node:path";
import { Liquid } from "liquidjs";

const engine = new Liquid({
  root: path.resolve(__dirname, "../../email/templates/html"),
  extname: ".liquid",
});

export async function renderLiquidToHtml(
  templateName: string,
  data: object
): Promise<string> {
  try {
    const filePath = path.join(
      __dirname,
      "../../email/templates/html",
      `${templateName}.liquid`
    );

    const templateContent = await fs.readFile(filePath, "utf-8");
    return await engine.parseAndRender(templateContent, data);
  } catch (error) {
    throw new Error(`Failed to render template ${templateName}: ${error}`);
  }
}
