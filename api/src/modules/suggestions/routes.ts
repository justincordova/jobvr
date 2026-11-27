import { createRoute } from "@hono/zod-openapi";
import {
  bodyErrors,
  commonErrors,
  conflict,
  json,
  NullResponse,
  notFound,
  validationError,
  writeErrors,
} from "@/lib/routes";
import { CompanyResponse } from "@/modules/companies/schemas";
import { AddSuggestionBody, SuggestionListResponse, SuggestionParams } from "./schemas";

const tags = ["suggestions"];

export const list = createRoute({
  operationId: "listSuggestions",
  method: "get",
  path: "/",
  tags,
  summary: "Open suggestions with current listings",
  responses: {
    200: json(SuggestionListResponse, "Suggestions, most listings first"),
    ...commonErrors,
  },
});

export const add = createRoute({
  operationId: "addSuggestion",
  method: "post",
  path: "/{id}/add",
  tags,
  summary: "Add the suggested company",
  request: {
    params: SuggestionParams,
    body: { ...json(AddSuggestionBody, "Tier for the new company"), required: false },
  },
  responses: {
    201: json(CompanyResponse, "The created company"),
    400: validationError,
    404: notFound,
    409: conflict,
    ...bodyErrors,
    ...writeErrors,
    ...commonErrors,
  },
});

export const dismiss = createRoute({
  operationId: "dismissSuggestion",
  method: "post",
  path: "/{id}/dismiss",
  tags,
  summary: "Dismiss a suggestion for good",
  request: { params: SuggestionParams },
  responses: {
    200: json(NullResponse, "Dismissed"),
    400: validationError,
    404: notFound,
    ...writeErrors,
    ...commonErrors,
  },
});
