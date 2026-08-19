import type {
  CredentialValidators,
  ExecutionContext,
  ProviderExecutors,
  ResolvedCredential,
} from "../../core/types.ts";

import { defineProviderExecutors, ProviderRequestError } from "../provider-runtime.ts";
import { fetchQuickbooksCompanyInfo, quickbooksActionHandlers, readQuickbooksConnection } from "./runtime.ts";

const service = "quickbooks";

// The generic executor factory (not defineOAuthProviderExecutors) because handlers need
// realmId and the API host from credential metadata, which the OAuth context does not expose.
export const executors: ProviderExecutors = defineProviderExecutors({
  service,
  handlers: quickbooksActionHandlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch) {
    const credential = await requireQuickbooksCredential(context);
    const { realmId, baseUrl } = readQuickbooksConnection(credential.metadata);
    return {
      accessToken: credential.accessToken,
      realmId,
      baseUrl,
      fetcher,
      signal: context.signal,
    };
  },
});

export const credentialValidators: CredentialValidators = {
  oauth2(input, { fetcher, signal }) {
    return fetchQuickbooksCompanyInfo(input.accessToken, input.metadata, fetcher, signal);
  },
};

type QuickbooksCredential = Extract<ResolvedCredential, { authType: "oauth2" }>;

async function requireQuickbooksCredential(context: ExecutionContext): Promise<QuickbooksCredential> {
  const credential = await context.getCredential(service);
  if (credential?.authType === "oauth2") {
    return credential;
  }
  throw new ProviderRequestError(401, "Connect QuickBooks Online first.");
}
