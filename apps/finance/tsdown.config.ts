import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { app: "src/app.lambda.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  minify: true,
  sourcemap: true,
  outDir: "dist-lambda",
  clean: true,
  dts: false,
  deps: {
    alwaysBundle: [
      /@restatedev\//,
      /@restate-tob\//,
      /luxon/,
      /pg/,
      /pino/,
      /zod/,
    ],
    onlyBundle: false,
  },
  outputOptions: {
    codeSplitting: false,
  },
});
