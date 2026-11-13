import {
  createHttpClient,
  createNtfyNotifier,
  type Database,
  type Logger,
  type Registry,
  runCleanup,
  runNotify,
  runPoll,
  SCHEDULER_FIRST_TICK_MS,
  SCHEDULER_TICK_MS,
} from "@jobvr/core";

export interface SchedulerOptions {
  database: Database;
  registry: Registry;
  ntfyUrl?: string;
  publicUrl: string;
  logger: Logger;
}

/**
 * In-process scheduler: one tick 10 s after boot, then every 5 minutes. Each
 * task checks whether it's due (and takes its own advisory lock), so settings
 * changes apply on the next tick. On AWS this becomes an EventBridge rule.
 */
export const startScheduler = (options: SchedulerOptions) => {
  const { database, registry, logger } = options;
  const http = createHttpClient();
  const notifier = options.ntfyUrl ? createNtfyNotifier(options.ntfyUrl) : null;
  let running = false;

  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      logger.error({ err, task: name }, "scheduled task failed");
    }
  };

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await step("poll", () => runPoll({ database, registry, http, logger }));
      await step("notify", () =>
        runNotify({ database, registry, notifier, publicUrl: options.publicUrl, logger }),
      );
      await step("cleanup", () => runCleanup({ database, logger }));
    } finally {
      running = false;
    }
  };

  const first = setTimeout(() => void tick(), SCHEDULER_FIRST_TICK_MS);
  const interval = setInterval(() => void tick(), SCHEDULER_TICK_MS);
  return {
    tick,
    stop: () => {
      clearTimeout(first);
      clearInterval(interval);
    },
  };
};
