import { createRoute } from "@hono/zod-openapi";
import {
  bodyErrors,
  commonErrors,
  conflict,
  json,
  NullResponse,
  notFound,
  validationError,
} from "@/lib/routes";
import {
  CompanyListResponse,
  CompanyParams,
  CompanyResponse,
  CreateCompanyBody,
  UpdateCompanyBody,
} from "./schemas";

const tags = ["companies"];

export const list = createRoute({
  operationId: "listCompanies",
  method: "get",
  path: "/",
  tags,
  summary: "List companies with poll health",
  responses: {
    200: json(CompanyListResponse, "All companies"),
    ...commonErrors,
  },
});

export const create = createRoute({
  operationId: "createCompany",
  method: "post",
  path: "/",
  tags,
  summary: "Add a company",
  request: { body: { ...json(CreateCompanyBody, "Company"), required: true } },
  responses: {
    201: json(CompanyResponse, "The created company"),
    400: validationError,
    409: conflict,
    ...bodyErrors,
    ...commonErrors,
  },
});

export const update = createRoute({
  operationId: "updateCompany",
  method: "patch",
  path: "/{id}",
  tags,
  summary: "Edit a company",
  request: {
    params: CompanyParams,
    body: { ...json(UpdateCompanyBody, "Fields to update"), required: true },
  },
  responses: {
    200: json(CompanyResponse, "The updated company"),
    400: validationError,
    404: notFound,
    409: conflict,
    ...bodyErrors,
    ...commonErrors,
  },
});

export const remove = createRoute({
  operationId: "deleteCompany",
  method: "delete",
  path: "/{id}",
  tags,
  summary: "Delete a company (its jobs keep the company name)",
  request: { params: CompanyParams },
  responses: {
    200: json(NullResponse, "Deleted"),
    400: validationError,
    404: notFound,
    ...commonErrors,
  },
});
