import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import {
  buildDownloadBlobPath,
  buildUploadBlobPath,
} from "./pipeline-storage.js";

describe("pipeline storage path builders", () => {
  beforeEach(() => {
    process.env.APP_ENV = "development";
    process.env.AZURE_STORAGE_PIPELINE_PREFIX = "parquet";
  });

  test("buildUploadBlobPath uses the provided reference month", () => {
    const blobPath = buildUploadBlobPath(
      "soa_ABC.parquet",
      new Date("2026-04-04T00:00:00.000Z")
    );

    assert.equal(blobPath, "parquet/development/2026-04/soa_ABC.parquet");
  });

  test("buildDownloadBlobPath keeps the existing one-month offset deterministically", () => {
    const blobPath = buildDownloadBlobPath(
      "ABC",
      new Date("2026-04-04T00:00:00.000Z")
    );

    assert.equal(blobPath, "parquet/development/2026-03/soa_ABC.parquet");
  });

  test("buildDownloadBlobPath handles month-end references without rollover errors", () => {
    const blobPath = buildDownloadBlobPath(
      "ABC",
      new Date("2026-03-31T23:59:59.000Z")
    );

    assert.equal(blobPath, "parquet/development/2026-02/soa_ABC.parquet");
  });
});
