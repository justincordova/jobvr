import {
  type AutoTierState,
  createAutoTierState,
  createHttpClient,
  createNtfyNotifier,
  type Database,
  formatDuration,
  type Logger,
  type Registry,
  runAutoAddCompanies,
  runAutoTier,
  runBackupCheck,
  runCleanup,
  runHealCompanies,
  runNotify,
  runPoll,
  runPollStallCheck,
  SCHEDULER_FIRST_TICK_MS,
  SCHEDULER_TICK_MS,
  type TierRater,
} from "@jobvr/core";

export interface SchedulerOptions {
  database: Database;
  registry: Registry;
  ntfyUrl?: string;
  publicUrl: string;
  logger: Logger;
  /** Rates new companies' tiers; unset or null without OPENAI_API_KEY. */
  tierRater?: TierRater | null;
  tierState?: AutoTierState;
}

/**
 * In-process scheduler: one tick 10 s after boot, then every 5 minutes, never
 * two at once. Each task checks whether it's due (poll and notify also take an
 * advisory lock), so settings changes apply on the next tick. On AWS this becomes
 * an EventBridge rule.
 */
export const startScheduler = (options: SchedulerOptions) => {
  const { database, registry, logger } = options;
  // Tasks get the root logger and tag their own lines (poll, notify, cleanup)
  const log = logger.child({ module: "scheduler" });
  const http = createHttpClient();
  const notifier = options.ntfyUrl ? createNtfyNotifier(options.ntfyUrl) : null;
  // Boards that failed the auto-add check, so each is retried once a day, not every tick
  const autoAddFailures = new Map<string, number>();
  // Broken boards searched lately, so each is searched every few hours, not every tick
  const healAttempts = new Map<string, number>();
  const tierState = options.tierState ?? createAutoTierState();
  let running: number | null = null;
  let current: Promise<void> = Promise.resolve();
  const stopping = new AbortController();
  const startedAt = new Date();

  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      log.error({ err, task: name }, `${name} crashed; the next tick tries again`);
    }
  };

  const runTick = async () => {
    if (stopping.signal.aborted) return;
    if (running !== null) {
      log.warn(
        { runningForMs: Math.round(performance.now() - running) },
        `tick skipped: the previous tick is still running after ${formatDuration(performance.now() - running)}`,
      );
      return;
    }
    running = performance.now();
    try {
      await step("poll", () =>
        runPoll({ database, registry, http, logger, signal: stopping.signal }),
      );
      // After a stop, nothing new starts (a push mid-send still finishes and is marked)
      if (stopping.signal.aborted) return;
      await step("auto-add", () =>
        runAutoAddCompanies({ database, registry, http, logger, failures: autoAddFailures }),
      );
      if (stopping.signal.aborted) return;
      await step("tiers", () =>
        runAutoTier({ database, rater: options.tierRater ?? null, state: tierState, logger }),
      );
      if (stopping.signal.aborted) return;
      await step("heal", () =>
        runHealCompanies({ database, registry, http, logger, attempts: healAttempts }),
      );
      if (stopping.signal.aborted) return;
      await step("notify", () =>
        runNotify({ database, registry, notifier, publicUrl: options.publicUrl, logger }),
      );
      if (stopping.signal.aborted) return;
      await step("cleanup", () => runCleanup({ database, logger }));
      if (stopping.signal.aborted) return;
      await step("backup check", () => runBackupCheck({ database, notifier, logger }));
      if (stopping.signal.aborted) return;
      await step("poll check", () =>
        runPollStallCheck({ database, notifier, bootedAt: startedAt, logger }),
      );
      log.debug({}, `tick done in ${formatDuration(performance.now() - running)}`);
    } finally {
      running = null;
    }
  };
  log.info(
    { tickMs: SCHEDULER_TICK_MS, firstTickMs: SCHEDULER_FIRST_TICK_MS, push: Boolean(notifier) },
    `scheduler started: first tick in ${formatDuration(SCHEDULER_FIRST_TICK_MS)}, then every ${formatDuration(SCHEDULER_TICK_MS)}${notifier ? "" : " (NTFY_URL unset: no pushes)"}`,
  );

  const tick = () => {
    // A skipped tick returns at once; only a tick that runs is what stop() waits for
    if (running !== null || stopping.signal.aborted) return runTick();
    current = runTick();
    return current;
  };
  const first = setTimeout(() => void tick(), SCHEDULER_FIRST_TICK_MS);
  const interval = setInterval(() => void tick(), SCHEDULER_TICK_MS);
  return {
    tick,
    /** Stops ticking, aborts a running poll, and resolves when the running tick is done. */
    stop: async () => {
      clearTimeout(first);
      clearInterval(interval);
      stopping.abort();
      await current;
    },
  };
};
