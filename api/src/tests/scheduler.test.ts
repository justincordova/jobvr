import { getSettingsState, type Registry, type SourceAdapter } from "@jobvr/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startScheduler } from "@/scheduler";
import { setupTestDeps } from "./helpers";

const silent = {
  child: () => silent,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

describe("scheduler", () => {
  const ctx = setupTestDeps(beforeAll, afterAll);

  it("stop() aborts a running poll and waits for it, without writing a half poll", async () => {
    let started!: () => void;
    const fetching = new Promise<void>((r) => {
      started = r;
    });
    // A source that hangs until the poll is aborted (like a board timing out)
    const hanging: SourceAdapter = {
      id: "simplify",
      label: "SimplifyJobs",
      kind: "aggregator",
      idPrefix: "sj",
      concurrency: 1,
      fetch: ({ signal }) =>
        new Promise((_, reject) => {
          started();
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    };
    const registry: Registry = [hanging];
    const scheduler = startScheduler({
      database: ctx.database,
      registry,
      publicUrl: "http://localhost:5173",
      logger: silent as never,
    });
    const tick = scheduler.tick();
    await fetching;
    const t0 = performance.now();
    await scheduler.stop();
    await tick;
    expect(performance.now() - t0).toBeLessThan(1_000);
    // Nothing was recorded: the next start polls again
    expect((await getSettingsState(ctx.database.db)).lastPollAt).toBeNull();
    // Stopped: later ticks do nothing
    await scheduler.tick();
    expect((await getSettingsState(ctx.database.db)).lastPollAt).toBeNull();
  });

  it("logs a crashing task and still runs the ones after it", async () => {
    const errors: string[] = [];
    const logger = {
      ...silent,
      child: () => logger,
      error: (_fields: unknown, msg: string) => void errors.push(msg),
    };
    // No usable database: every task throws
    const broken = { ...ctx.database, db: undefined as never };
    const scheduler = startScheduler({
      database: broken,
      registry: [],
      publicUrl: "http://localhost:5173",
      logger: logger as never,
    });
    await scheduler.tick();
    await scheduler.stop();
    expect(errors).toEqual([
      "poll crashed; the next tick tries again",
      "notify crashed; the next tick tries again",
      "cleanup crashed; the next tick tries again",
      "backup check crashed; the next tick tries again",
      "poll check crashed; the next tick tries again",
    ]);
  });
});
