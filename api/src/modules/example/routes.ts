import { createRoute } from "@hono/zod-openapi";
import {
  CreateExampleBody,
  ErrorResponse,
  ExampleListResponse,
  ExampleParams,
  ExampleResponse,
  MessageResponse,
  UpdateExampleBody,
} from "./schemas";

const tags = ["example"];

const json = <T>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const notFound = json(ErrorResponse, "Example not found");
const validationError = json(ErrorResponse, "Request validation failed");

// Errors any route can return (rate limit, timeout, unexpected failure)
const commonErrors = {
  429: json(ErrorResponse, "Too many requests"),
  500: json(ErrorResponse, "Internal server error"),
  503: json(ErrorResponse, "Request timed out"),
};

// Additional errors for routes that accept a JSON body
const bodyErrors = {
  413: json(ErrorResponse, "Request body too large"),
};

export const list = createRoute({
  operationId: "listExamples",
  method: "get",
  path: "/",
  tags,
  summary: "List examples",
  responses: {
    200: json(ExampleListResponse, "All examples"),
    ...commonErrors,
  },
});

export const create = createRoute({
  operationId: "createExample",
  method: "post",
  path: "/",
  tags,
  summary: "Create an example",
  request: {
    body: { ...json(CreateExampleBody, "Example to create"), required: true },
  },
  responses: {
    201: json(ExampleResponse, "The created example"),
    400: validationError,
    ...bodyErrors,
    ...commonErrors,
  },
});

export const getOne = createRoute({
  operationId: "getExample",
  method: "get",
  path: "/{id}",
  tags,
  summary: "Get an example",
  request: { params: ExampleParams },
  responses: {
    200: json(ExampleResponse, "The requested example"),
    400: validationError,
    404: notFound,
    ...commonErrors,
  },
});

export const update = createRoute({
  operationId: "updateExample",
  method: "patch",
  path: "/{id}",
  tags,
  summary: "Update an example",
  request: {
    params: ExampleParams,
    body: { ...json(UpdateExampleBody, "Fields to update"), required: true },
  },
  responses: {
    200: json(ExampleResponse, "The updated example"),
    400: validationError,
    404: notFound,
    ...bodyErrors,
    ...commonErrors,
  },
});

export const remove = createRoute({
  operationId: "deleteExample",
  method: "delete",
  path: "/{id}",
  tags,
  summary: "Delete an example",
  request: { params: ExampleParams },
  responses: {
    200: json(MessageResponse, "Example deleted"),
    400: validationError,
    404: notFound,
    ...commonErrors,
  },
});
