import type { ProviderDefinition } from "../../core/types.ts";

import { quickbooksActions } from "./actions.ts";
import { quickbooksProviderScopes } from "./scopes.ts";

const service = "quickbooks";

export const provider: ProviderDefinition = {
  service,
  displayName: "QuickBooks Online",
  categories: ["Finance"],
  authTypes: ["oauth2"],
  auth: [
    {
      type: "oauth2",
      authorizationUrl: "https://appcenter.intuit.com/connect/oauth2",
      tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      refreshTokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      scopes: quickbooksProviderScopes,
      tokenEndpointAuthMethod: "client_secret_basic",
      clientConfigFields: [
        {
          key: "realmId",
          label: "Company ID (realm ID)",
          inputType: "text",
          required: true,
          secret: false,
          placeholder: "9341453816381234",
          description:
            "The QuickBooks Online company ID. In QuickBooks open Settings, then Account and settings, then Billing and subscription — the Company ID is shown at the top. Intuit also returns it as realmId in the OAuth callback URL.",
        },
        {
          key: "environment",
          label: "Environment",
          inputType: "text",
          required: false,
          secret: false,
          placeholder: "production",
          description:
            "production (default) targets quickbooks.api.intuit.com; sandbox targets sandbox-quickbooks.api.intuit.com for Intuit developer sandbox companies.",
        },
      ],
    },
  ],
  homepageUrl: "https://quickbooks.intuit.com",
  actions: quickbooksActions,
};
