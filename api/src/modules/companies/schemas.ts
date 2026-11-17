import { z } from "@hono/zod-openapi";
import { COMPANY_STATUSES, TIERS } from "@jobvr/core";
import { envelope, isoNullable } from "@/lib/routes";

const text = (max: number) => z.string().trim().max(max).nullish();

export const CompanyHealthSchema = z.object({
  lastAttemptAt: isoNullable,
  lastSuccessAt: isoNullable,
  consecutiveFailures: z.number().int(),
  lastError: z.string().nullable(),
});

export const CompanySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    tier: z.enum(TIERS),
    track: z.boolean(),
    ats: z.string(),
    slug: z.string().nullable(),
    careersUrl: z.string().nullable(),
    notes: z.string().nullable(),
    status: z.enum(COMPANY_STATUSES),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    health: CompanyHealthSchema.nullable(),
  })
  .openapi("Company");

export const CompanyResponse = envelope(CompanySchema);
export const CompanyListResponse = envelope(z.array(CompanySchema));

export const CreateCompanyBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    city: text(200),
    state: text(100),
    tier: z.enum(TIERS),
    /** Defaults to true when the company can be polled and its tier isn't S/A. */
    track: z.boolean().optional(),
    /** A registered ATS adapter id, or "other". */
    ats: z.string().min(1).openapi({ example: "greenhouse" }),
    slug: text(200),
    careersUrl: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .nullish(),
    notes: text(5000),
    /** Defaults to manual_only for "other", else ok. */
    status: z.enum(COMPANY_STATUSES).optional(),
  })
  .openapi("CreateCompanyBody");

export const UpdateCompanyBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    city: text(200),
    state: text(100),
    tier: z.enum(TIERS).optional(),
    track: z.boolean().optional(),
    ats: z.string().min(1).optional(),
    slug: text(200),
    careersUrl: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .nullish(),
    notes: text(5000),
    status: z.enum(COMPANY_STATUSES).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { error: "Provide at least one field to update" })
  .openapi("UpdateCompanyBody");

export const CompanyParams = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
});
