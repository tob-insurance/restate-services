import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";

let containerClient: ContainerClient | null = null;

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

  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString);
  containerClient = blobServiceClient.getContainerClient(containerName);

  return containerClient;
}
