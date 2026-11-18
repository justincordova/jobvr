import { z } from "@hono/zod-openapi";
import { ACTIVITY_CAPACITY, ACTIVITY_LEVELS } from "@/lib/activity-log";
import { envelope } from "@/lib/routes";

export const LogListQuery = z.object({
  /** Only entries after this sequence number (the client's cursor). */
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_CAPACITY).default(500),
});

export const LogEntrySchema = z
  .object({
    seq: z.number().int(),
    time: z.string(),
    level: z.enum(ACTIVITY_LEVELS),
    module: z.string().nullable(),
    msg: z.string(),
    error: z.string().nullable(),
  })
  .openapi("LogEntry");

export const LogListResponse = envelope(
  z.object({
    entries: z.array(LogEntrySchema),
    latestSeq: z.number().int(),
    /** When the server started; a different value means it restarted (sequence starts over). */
    startedAt: z.iso.datetime(),
    capacity: z.number().int(),
  }),
);
