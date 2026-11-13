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
import { ApplicationResponse } from "@/modules/applications/schemas";
import { JobListQuery, JobListResponse, JobParams, JobStateBody } from "./schemas";

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

export const setState = createRoute({
  operationId: "setJobState",
  method: "patch",
  path: "/{id}",
  tags,
  summary: "Save, hide, or reset a job",
  request: {
    params: JobParams,
    body: { ...json(JobStateBody, "New state"), required: true },
  },
  responses: {
    200: json(NullResponse, "State updated"),
    400: validationError,
    404: notFound,
    409: conflict,
    ...bodyErrors,
    ...commonErrors,
  },
});

export const apply = createRoute({
  operationId: "applyToJob",
  method: "post",
  path: "/{id}/apply",
  tags,
  summary: "Mark a job applied and create its application",
  request: { params: JobParams },
  responses: {
    201: json(ApplicationResponse, "The created application"),
    400: validationError,
    404: notFound,
    409: conflict,
    ...commonErrors,
  },
});
