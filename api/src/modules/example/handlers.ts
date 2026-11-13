import type { RouteHandler } from "@hono/zod-openapi";
import { HTTP_STATUS } from "@/constants";
import type { AppBindings } from "@/lib/create-app";
import { created, fail, ok } from "@/utils/response";
import type { create, getOne, list, remove, update } from "./routes";
import {
  createExample,
  deleteExample,
  getAllExamples,
  getExampleById,
  updateExample,
} from "./services";

const notFound = (id: number) => `Example with ID ${id} not found`;

export const listHandler: RouteHandler<typeof list, AppBindings> = (c) => {
  const examples = getAllExamples();
  return ok(c, examples, { count: examples.length });
};

export const createHandler: RouteHandler<typeof create, AppBindings> = (c) => {
  const example = createExample(c.req.valid("json"));
  c.var.logger.info({ exampleId: example.id }, "Example created");
  return created(c, example, "Example created successfully");
};

export const getOneHandler: RouteHandler<typeof getOne, AppBindings> = (c) => {
  const { id } = c.req.valid("param");
  const example = getExampleById(id);
  if (!example) {
    return fail(c, HTTP_STATUS.NOT_FOUND, notFound(id));
  }
  return ok(c, example);
};

export const updateHandler: RouteHandler<typeof update, AppBindings> = (c) => {
  const { id } = c.req.valid("param");
  const example = updateExample(id, c.req.valid("json"));
  if (!example) {
    return fail(c, HTTP_STATUS.NOT_FOUND, notFound(id));
  }
  return ok(c, example);
};

export const removeHandler: RouteHandler<typeof remove, AppBindings> = (c) => {
  const { id } = c.req.valid("param");
  if (!deleteExample(id)) {
    return fail(c, HTTP_STATUS.NOT_FOUND, notFound(id));
  }
  return ok(c, null, { message: "Example deleted successfully" });
};
