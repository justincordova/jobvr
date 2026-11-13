import { hc } from "hono/client";
import type { AppType } from "./app";

export type { AppType };

// Type is computed once here rather than in every consumer, which keeps editors fast
export type Client = ReturnType<typeof hc<AppType>>;

/** Create a fully typed RPC client for this API. */
export const createClient = (...args: Parameters<typeof hc>): Client => hc<AppType>(...args);
