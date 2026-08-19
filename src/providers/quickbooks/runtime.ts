import type { CredentialValidationResult } from "../../core/types.ts";
import type { ProviderFetch, ProviderRuntimeHandler } from "../provider-runtime.ts";
import type { QuickbooksActionName } from "./actions.ts";

import { compactObject, optionalRecord, optionalString } from "../../core/cast.ts";
import { encodePathSegment } from "../../core/request.ts";
import {
  createProviderTimeout,
  isAbortLikeError,
  ProviderRequestError,
  providerUserAgent,
} from "../provider-runtime.ts";

export const quickbooksProductionBaseUrl = "https://quickbooks.api.intuit.com";
export const quickbooksSandboxBaseUrl = "https://sandbox-quickbooks.api.intuit.com";

const quickbooksDefaultRequestTimeoutMs = 30_000;
const quickbooksQueryEntities = new Set(["Invoice", "Customer", "Payment", "CreditMemo"]);
const quickbooksReportNames = new Set([
  "AgedReceivables",
  "AgedReceivableDetail",
  "CustomerBalance",
  "CustomerBalanceDetail",
  "ProfitAndLoss",
  "TransactionList",
]);
const quickbooksMaxResultsCap = 50;
const quickbooksMaxWhereLength = 500;

export interface QuickbooksContext {
  accessToken: string;
  realmId: string;
  baseUrl: string;
  fetcher: ProviderFetch;
  signal?: AbortSignal;
}

export interface QuickbooksConnectionInfo {
  realmId: string;
  baseUrl: string;
}

/**
 * Resolve realmId and API host from credential metadata. Validator-stamped metadata wins over
 * the OAuth-client extra field; both survive token refreshes (the refresh service carries
 * metadata forward), so every API call can rely on realmId being present after connect.
 */
export function readQuickbooksConnection(metadata: Record<string, unknown>): QuickbooksConnectionInfo {
  const clientExtra = optionalRecord(metadata.oauthClientExtra);
  const realmId = optionalString(metadata.realmId) ?? optionalString(clientExtra?.realmId);
  if (!realmId) {
    throw new ProviderRequestError(
      400,
      "QuickBooks realmId is missing. Set the Company ID (realm ID) field on the QuickBooks OAuth client, then reconnect.",
    );
  }
  const storedBaseUrl = optionalString(metadata.apiBaseUrl);
  const environment = optionalString(clientExtra?.environment)?.toLowerCase();
  const baseUrl = storedBaseUrl ?? (environment === "sandbox" ? quickbooksSandboxBaseUrl : quickbooksProductionBaseUrl);
  return { realmId, baseUrl };
}

type QuickbooksRequestPhase = "validate" | "execute";
type QuickbooksActionHandler = ProviderRuntimeHandler<QuickbooksContext>;

interface QuickbooksRequestInput {
  context: Pick<QuickbooksContext, "accessToken" | "baseUrl" | "fetcher" | "signal">;
  path: string;
  phase: QuickbooksRequestPhase;
  query?: Record<string, string | undefined>;
}

export const quickbooksActionHandlers: Record<QuickbooksActionName, QuickbooksActionHandler> = {
  async query(input, context) {
    return await requestQuickbooksJson({
      context,
      path: `/v3/company/${encodePathSegment(context.realmId)}/query`,
      phase: "execute",
      query: { query: buildEntityQuery(input) },
    });
  },
  async get_report(input, context) {
    const report = requiredReportName(input.report);
    return await requestQuickbooksJson({
      context,
      path: `/v3/company/${encodePathSegment(context.realmId)}/reports/${encodePathSegment(report)}`,
      phase: "execute",
      query: compactObject({
        date_macro: optionalString(input.date_macro),
        start_date: optionalString(input.start_date),
        end_date: optionalString(input.end_date),
        customer: optionalString(input.customer_id),
      }),
    });
  },
  async get_company_info(_input, context) {
    return await requestQuickbooksJson({
      context,
      path: `/v3/company/${encodePathSegment(context.realmId)}/companyinfo/${encodePathSegment(context.realmId)}`,
      phase: "execute",
    });
  },
};

export async function fetchQuickbooksCompanyInfo(
  accessToken: string,
  metadata: Record<string, unknown>,
  fetcher: ProviderFetch,
  signal?: AbortSignal,
): Promise<CredentialValidationResult> {
  const { realmId, baseUrl } = readQuickbooksConnection(metadata);
  const payload = await requestQuickbooksJson({
    context: { accessToken, baseUrl, fetcher, signal },
    path: `/v3/company/${encodePathSegment(realmId)}/companyinfo/${encodePathSegment(realmId)}`,
    phase: "validate",
  });
  const info = optionalRecord(payload.CompanyInfo);
  const companyName = optionalString(info?.CompanyName);

  return {
    profile: {
      accountId: realmId,
      displayName: companyName ?? `QuickBooks company ${realmId}`,
    },
    grantedScopes: readGrantedScopes(metadata.scope),
    metadata: compactObject({
      realmId,
      apiBaseUrl: baseUrl,
      companyName,
      country: optionalString(info?.Country),
    }),
  };
}

function buildEntityQuery(input: Record<string, unknown>): string {
  const entity = optionalString(input.entity);
  if (!entity || !quickbooksQueryEntities.has(entity)) {
    throw new ProviderRequestError(400, `entity must be one of: ${[...quickbooksQueryEntities].join(", ")}`);
  }
  const clauses = [`SELECT * FROM ${entity}`];
  const where = optionalString(input.where);
  if (where) {
    clauses.push(`WHERE ${sanitizeWhereFragment(where)}`);
  }
  const startPosition = positiveIntegerOrUndefined(input.start_position, "start_position");
  if (startPosition) {
    clauses.push(`STARTPOSITION ${startPosition}`);
  }
  const maxResults = positiveIntegerOrUndefined(input.max_results, "max_results") ?? 20;
  clauses.push(`MAXRESULTS ${Math.min(maxResults, quickbooksMaxResultsCap)}`);
  return clauses.join(" ");
}

function sanitizeWhereFragment(where: string): string {
  const trimmed = where.trim();
  if (trimmed.length > quickbooksMaxWhereLength) {
    throw new ProviderRequestError(400, `where must be at most ${quickbooksMaxWhereLength} characters`);
  }
  if (trimmed.includes(";")) {
    throw new ProviderRequestError(400, "where must not contain ';'");
  }
  if ((trimmed.match(/'/gu) ?? []).length % 2 !== 0) {
    throw new ProviderRequestError(400, "where has unbalanced single quotes");
  }
  return trimmed;
}

function positiveIntegerOrUndefined(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(optionalString(value));
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ProviderRequestError(400, `${field} must be a positive integer`);
  }
  return parsed;
}

function requiredReportName(value: unknown): string {
  const report = optionalString(value);
  if (!report || !quickbooksReportNames.has(report)) {
    throw new ProviderRequestError(400, `report must be one of: ${[...quickbooksReportNames].join(", ")}`);
  }
  return report;
}

function readGrantedScopes(value: unknown): string[] {
  return (optionalString(value) ?? "")
    .split(/[ ,]+/u)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function requestQuickbooksJson(input: QuickbooksRequestInput): Promise<Record<string, unknown>> {
  const timeout = createProviderTimeout(input.context.signal, quickbooksDefaultRequestTimeoutMs);
  try {
    const url = new URL(`${input.context.baseUrl}${input.path}`);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    const response = await input.context.fetcher(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.context.accessToken}`,
        "user-agent": providerUserAgent,
      },
      signal: timeout.signal,
    });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = text;
    }

    if (!response.ok) {
      throw createQuickbooksError(response.status, payload, input.phase);
    }

    const record = optionalRecord(payload);
    if (!record) {
      throw new ProviderRequestError(502, "QuickBooks returned an invalid payload", payload);
    }
    return record;
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      throw error;
    }
    if (timeout.didTimeout() || isAbortLikeError(error)) {
      throw new ProviderRequestError(504, "QuickBooks request timed out");
    }
    throw new ProviderRequestError(
      502,
      error instanceof Error ? `QuickBooks request failed: ${error.message}` : "QuickBooks request failed",
    );
  } finally {
    timeout.cleanup();
  }
}

function createQuickbooksError(status: number, payload: unknown, phase: QuickbooksRequestPhase): ProviderRequestError {
  const record = optionalRecord(payload);
  const fault = optionalRecord(record?.Fault) ?? optionalRecord(record?.fault);
  const errors = Array.isArray(fault?.Error) ? fault.Error : [];
  const firstError = optionalRecord(errors[0]);
  const message = optionalString(firstError?.Message) ?? "QuickBooks request failed";
  const detail = optionalString(firstError?.Detail);

  let mappedStatus = status;
  if (phase === "validate") {
    // During credential validation, auth failures surface as conflicts and other client
    // errors as bad input, matching the Zoom validator's status mapping.
    mappedStatus = status === 401 || status === 403 ? 409 : status < 500 ? 400 : status;
  }
  return new ProviderRequestError(mappedStatus, detail ? `${message}: ${detail}` : message, payload);
}
