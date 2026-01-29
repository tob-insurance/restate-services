import { generateSoaPipeline } from "..";

async function main() {
  try {
    const asAtDate = new Date();
    await generateSoaPipeline(asAtDate);
    console.log("All pipelines completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("Pipeline failed:", error);
    process.exit(1);
  }
}

main();
