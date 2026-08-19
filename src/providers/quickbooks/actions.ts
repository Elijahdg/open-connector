import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";
import { quickbooksAccountingScope } from "./scopes.ts";

const service = "quickbooks";

export type QuickbooksActionName = "query" | "get_report" | "get_company_info";

const entitySchema = s.stringEnum("The QuickBooks entity to query.", ["Invoice", "Customer", "Payment", "CreditMemo"]);

const whereSchema = s.nonEmptyString(
  "A QuickBooks query WHERE fragment without the WHERE keyword, with single-quoted values, such as DocNumber = '1043', Balance > '0', TxnDate >= '2026-07-01', or DisplayName LIKE 'Trans%'.",
);

const maxResultsSchema = s.integer("The maximum number of rows to return.", {
  minimum: 1,
  maximum: 50,
  default: 20,
});

const startPositionSchema = s.integer("The 1-based row offset for paging.", { minimum: 1 });

const reportSchema = s.stringEnum("The QuickBooks report to run.", [
  "AgedReceivables",
  "AgedReceivableDetail",
  "CustomerBalance",
  "CustomerBalanceDetail",
  "ProfitAndLoss",
  "TransactionList",
]);

const isoDateSchema = s.date("A report date filter in YYYY-MM-DD format.");

export const quickbooksActions: ActionDefinition[] = [
  defineProviderAction(service, {
    name: "query",
    description:
      "Run a read-only QuickBooks Online entity query. The SELECT statement is composed server-side from the structured input; raw SQL is never accepted.",
    requiredScopes: [quickbooksAccountingScope],
    inputSchema: s.object(
      "The input payload for a QuickBooks entity query.",
      {
        entity: entitySchema,
        where: whereSchema,
        max_results: maxResultsSchema,
        start_position: startPositionSchema,
      },
      {
        optional: ["where", "max_results", "start_position"],
      },
    ),
    outputSchema: s.looseObject(
      "The raw QuickBooks query response: { QueryResponse: { <Entity>: [...], startPosition, maxResults }, time }.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_report",
    description:
      "Run a read-only QuickBooks Online report such as AgedReceivables (AR aging), CustomerBalance, ProfitAndLoss, or TransactionList.",
    requiredScopes: [quickbooksAccountingScope],
    inputSchema: s.object(
      "The input payload for a QuickBooks report.",
      {
        report: reportSchema,
        date_macro: s.nonEmptyString(
          "A QuickBooks date macro such as Today, This Month, or This Fiscal Year-to-date. Ignored when explicit dates are set.",
        ),
        start_date: isoDateSchema,
        end_date: isoDateSchema,
        customer_id: s.nonEmptyString("A QuickBooks customer Id to narrow the report."),
      },
      {
        optional: ["date_macro", "start_date", "end_date", "customer_id"],
      },
    ),
    outputSchema: s.looseObject(
      "The raw QuickBooks report payload: { Header, Columns: { Column: [...] }, Rows: { Row: [...] } }.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_company_info",
    description: "Fetch the connected QuickBooks Online company profile. Doubles as the connection health check.",
    requiredScopes: [quickbooksAccountingScope],
    inputSchema: s.object("The input payload for fetching company info.", {}),
    outputSchema: s.looseObject("The raw QuickBooks company info payload: { CompanyInfo, time }."),
  }),
];
