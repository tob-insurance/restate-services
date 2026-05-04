import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
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
    throw new Error(
      "Missing Azure Storage connection string or container name"
    );
  }

  logDevModeWarning(containerName);

  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString);
  containerClient = blobServiceClient.getContainerClient(containerName);

  return containerClient;
}
