import { z } from "@hono/zod-openapi";
import { APPLICATION_STATUSES } from "@jobvr/core";
import { envelope } from "@/lib/routes";

export const ApplicationSchema = z
  .object({
    id: z.uuid(),
    jobId: z.string().nullable(),
    companyName: z.string(),
    title: z.string(),
    url: z.string().nullable(),
    status: z.enum(APPLICATION_STATUSES),
    appliedAt: z.iso.datetime(),
    notes: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("Application");

export const ApplicationResponse = envelope(ApplicationSchema);
export const ApplicationListResponse = envelope(z.array(ApplicationSchema));

export const CreateApplicationBody = z
  .object({
    companyName: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(300),
    url: z.url().max(2000).nullish(),
    status: z.enum(APPLICATION_STATUSES).optional(),
    appliedAt: z.iso.datetime({ offset: true }).optional(),
    notes: z.string().max(5000).nullish(),
  })
  .openapi("CreateApplicationBody");

export const UpdateApplicationBody = z
  .object({
    status: z.enum(APPLICATION_STATUSES).optional(),
    notes: z.string().max(5000).nullish(),
    appliedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { error: "Provide at least one field to update" })
  .openapi("UpdateApplicationBody");

export const ApplicationParams = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
});
