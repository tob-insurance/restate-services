import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { TerminalError } from "@restatedev/restate-sdk";

function getRequiredEnv(key: string): string {
  const value = process.env[key];

  if (!value) {
    throw new TerminalError(`Missing required environment variable: ${key}`);
  }
  return value;
}

let graphClient: Client | null = null;

export function getGraphClient(): Client {
  if (graphClient) {
    return graphClient;
  }

  const credential = new ClientSecretCredential(
    getRequiredEnv("AZURE_TENANT_ID"),
    getRequiredEnv("AZURE_CLIENT_ID"),
    getRequiredEnv("AZURE_CLIENT_SECRET")
  );

  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"],
  });

  graphClient = Client.initWithMiddleware({ authProvider });
  return graphClient;
}
