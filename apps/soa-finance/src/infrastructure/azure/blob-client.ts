import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { TerminalError } from "@restatedev/restate-sdk";
import { isDevelopment } from "../../constants";

let containerClient: ContainerClient | null = null;

function logDevModeWarning(containerName: string): void {
  if (!isDevelopment()) {
    return;
  }

  console.warn(
    `\n⚠️  [DEV MODE] Using Azure Storage container: "${containerName}"\n` +
      "   Double-check this is NOT your production storage before proceeding.\n"
  );
}

export function getContainerClient(): ContainerClient {
  if (containerClient) {
    return containerClient;
  }

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

  if (!(connectionString && containerName)) {
    throw new TerminalError(
      "Missing Azure Storage connection string or container name"
    );
  }

  logDevModeWarning(containerName);

  // Azure SDK reads HTTPS_PROXY from env natively
  console.log(
    `[Proxy Debug] HTTPS_PROXY=${process.env.HTTPS_PROXY}`,
    `HTTP_PROXY=${process.env.HTTP_PROXY}`,
    `NO_PROXY=${process.env.NO_PROXY}`
  );

  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString);
  containerClient = blobServiceClient.getContainerClient(containerName);

  return containerClient;
}
