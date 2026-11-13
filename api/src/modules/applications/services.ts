import type { z } from "@hono/zod-openapi";
import type { ApplicationRow, ApplicationStatus } from "@jobvr/core";
import { iso } from "@/lib/routes";
import type { ApplicationSchema } from "./schemas";

export const toApplicationDto = (a: ApplicationRow): z.infer<typeof ApplicationSchema> => ({
  id: a.id,
  jobId: a.jobId,
  companyName: a.companyName,
  title: a.title,
  url: a.url,
  status: a.status as ApplicationStatus,
  appliedAt: iso(a.appliedAt),
  notes: a.notes,
  updatedAt: iso(a.updatedAt),
});
