import { createRoute } from "@hono/zod-openapi";
import {
  bodyErrors,
  commonErrors,
  json,
  NullResponse,
  notFound,
  validationError,
} from "@/lib/routes";
import {
  ApplicationListResponse,
  ApplicationParams,
  ApplicationResponse,
  CreateApplicationBody,
  UpdateApplicationBody,
} from "./schemas";

const tags = ["applications"];

export const list = createRoute({
  operationId: "listApplications",
  method: "get",
  path: "/",
  tags,
  summary: "List applications",
  responses: {
    200: json(ApplicationListResponse, "All applications, newest first"),
    ...commonErrors,
  },
});

export const create = createRoute({
  operationId: "createApplication",
  method: "post",
  path: "/",
  tags,
  summary: "Add an application manually",
  request: { body: { ...json(CreateApplicationBody, "Application"), required: true } },
  responses: {
    201: json(ApplicationResponse, "The created application"),
    400: validationError,
    ...bodyErrors,
    ...commonErrors,
  },
});

export const update = createRoute({
  operationId: "updateApplication",
  method: "patch",
  path: "/{id}",
  tags,
  summary: "Update status, notes, or applied date",
  request: {
    params: ApplicationParams,
    body: { ...json(UpdateApplicationBody, "Fields to update"), required: true },
  },
  responses: {
    200: json(ApplicationResponse, "The updated application"),
    400: validationError,
    404: notFound,
    ...bodyErrors,
    ...commonErrors,
  },
});

export const remove = createRoute({
  operationId: "deleteApplication",
  method: "delete",
  path: "/{id}",
  tags,
  summary: "Delete an application (its job returns to the feed)",
  request: { params: ApplicationParams },
  responses: {
    200: json(NullResponse, "Deleted"),
    400: validationError,
    404: notFound,
    ...commonErrors,
  },
});
