import { createAutoTierState, type Database } from "@jobvr/core";
import { createTestDatabase, fakeHttp } from "@jobvr/core/testing";
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
      // No network: every board probe is a 404 unless a test swaps this
      http: fakeHttp({}).http,
      tierRater: null,
      tierState: createAutoTierState(),
    };
  });
  after(() => ctx.database.close());
  return ctx;
};
