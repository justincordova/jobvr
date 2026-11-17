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
  JobDetailsResponse,
  JobListQuery,
  JobListResponse,
  JobParams,
  JobStateBody,
} from "./schemas";

const tags = ["jobs"];

export const list = createRoute({
  operationId: "listJobs",
  method: "get",
  path: "/",
  tags,
  summary: "List jobs for a view, filtered",
  request: { query: JobListQuery },
  responses: {
    200: json(JobListResponse, "Jobs, newest first"),
    400: validationError,
    ...commonErrors,
  },
});

export const visit = createRoute({
  operationId: "markVisit",
  method: "post",
  path: "/visit",
  tags,
  summary: "Record a feed visit (for 'new since last visit')",
  responses: {
    200: json(NullResponse, "Visit recorded"),
    ...commonErrors,
  },
});

export const details = createRoute({
  operationId: "getJobDetails",
  method: "get",
  path: "/{id}/details",
  tags,
  summary: "A job's description and the key lines to read before applying",
  request: { params: JobParams },
  responses: {
    200: json(JobDetailsResponse, "Description and key lines"),
    400: validationError,
    404: notFound,
    ...commonErrors,
  },
});

export const setState = createRoute({
  operationId: "setJobState",
  method: "patch",
  path: "/{id}",
  tags,
  summary: "Save, hide, mark applied, or reset a job",
  request: {
    params: JobParams,
    body: { ...json(JobStateBody, "New state"), required: true },
  },
  responses: {
    200: json(NullResponse, "State updated"),
    400: validationError,
    404: notFound,
    ...bodyErrors,
    ...commonErrors,
  },
});
