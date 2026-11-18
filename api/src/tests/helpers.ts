import type { Database } from "@jobvr/core";
import { createTestDatabase } from "@jobvr/core/testing";
import { adapters } from "@jobvr/poller";
import { createActivityLog } from "@/lib/activity-log";
import type { AppDeps } from "@/lib/create-app";

type Hook = (fn: () => unknown) => void;

/** Fresh migrated database + deps per test file, with a controllable clock. */
export const setupTestDeps = (before: Hook, after: Hook) => {
  const ctx = {
    clock: new Date("2026-11-12T15:00:00Z"),
    database: undefined as unknown as Database,
    deps: undefined as unknown as AppDeps,
  };
  before(async () => {
    ctx.database = await createTestDatabase();
    ctx.deps = {
      database: ctx.database,
      registry: adapters,
      now: () => ctx.clock,
      activity: createActivityLog(),
    };
  });
  after(() => ctx.database.close());
  return ctx;
};
