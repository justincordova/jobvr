import { z } from "@hono/zod-openapi";

// Core entity
export const ExampleSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    email: z.email(),
    age: z.number().int().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("Example");

// Request bodies
export const CreateExampleBody = z
  .object({
    name: z.string().trim().min(1).max(100).openapi({ example: "Alice" }),
    email: z.email().max(254).openapi({ example: "alice@example.com" }),
    age: z.number().int().nonnegative().optional().openapi({ example: 30 }),
  })
  .openapi("CreateExampleBody");

export const UpdateExampleBody = CreateExampleBody.partial()
  .refine((body) => Object.keys(body).length > 0, { error: "Provide at least one field to update" })
  .openapi("UpdateExampleBody");

// Route params
export const ExampleParams = z.object({
  // Digits only: z.coerce.number() alone would also accept "1e0", " 1", or "0x1"
  id: z
    .string()
    .regex(/^[1-9]\d*$/, { error: "id must be a positive integer" })
    .transform(Number)
    .refine(Number.isSafeInteger, { error: "id is too large" })
    .openapi({ param: { name: "id", in: "path" }, example: "1" }),
});

// Response envelopes
export const ExampleResponse = z.object({
  success: z.literal(true),
  data: ExampleSchema,
  message: z.string().optional(),
});

export const ExampleListResponse = z.object({
  success: z.literal(true),
  data: z.array(ExampleSchema),
  count: z.number().int().optional(),
  message: z.string().optional(),
});

export const MessageResponse = z.object({
  success: z.literal(true),
  data: z.null(),
  message: z.string().optional(),
});

export const ErrorResponse = z
  .object({
    success: z.literal(false),
    error: z.string(),
    message: z.string().optional(),
    details: z.array(z.unknown()).optional(),
  })
  .openapi("ErrorResponse");

// Inferred types
export type Example = z.infer<typeof ExampleSchema>;
export type ExampleInput = z.infer<typeof CreateExampleBody>;
export type ExampleUpdate = z.infer<typeof UpdateExampleBody>;
