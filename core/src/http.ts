import { HTTP_MAX_BYTES, HTTP_MAX_RETRY_AFTER_MS, HTTP_TIMEOUT_MS, USER_AGENT } from "./constants";

export class HttpError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export type JsonResult =
  | { status: "not_modified" }
  | { status: "ok"; etag: string | null; data: unknown };

export type TextResult =
  | { status: "not_modified" }
  | { status: "ok"; etag: string | null; data: string };

export interface GetOptions {
  etag?: string | null;
  signal?: AbortSignal;
}

export interface HttpClient {
  /** GET a JSON document. Throws HttpError on transport errors and any status other than 2xx/304. */
  getJson(url: string, options?: GetOptions): Promise<JsonResult>;
  /** GET a text document (a GitHub README), with the same retries, ETag and size cap. */
  getText(url: string, options?: GetOptions): Promise<TextResult>;
}

export interface HttpClientDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  maxBytes?: number;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Reads a body as text, aborting once it exceeds `maxBytes`. */
const readCapped = async (res: Response, maxBytes: number): Promise<string> => {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new HttpError(`Response exceeds ${maxBytes} bytes`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(`Response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const retryAfterMs = (header: string | null): number | null => {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
};

/**
 * HTTP helper shared by all adapters: per-request timeout, one retry (jittered,
 * honoring Retry-After) on network errors, 5xx, and 429; ETag support; size cap.
 */
export const createHttpClient = (deps: HttpClientDeps = {}): HttpClient => {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const timeoutMs = deps.timeoutMs ?? HTTP_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? HTTP_MAX_BYTES;

  const attempt = async (
    url: string,
    options: GetOptions,
    json: boolean,
  ): Promise<{ result?: JsonResult; retryable: boolean; error?: HttpError; waitMs?: number }> => {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (options.signal) signals.push(options.signal);
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: json ? "application/json" : "text/plain, text/markdown, */*",
      "Accept-Encoding": "gzip",
    };
    if (options.etag) headers["If-None-Match"] = options.etag;

    let res: Response;
    try {
      res = await doFetch(url, { headers, signal: AbortSignal.any(signals) });
    } catch (err) {
      if (options.signal?.aborted) throw new HttpError("Aborted");
      const message = err instanceof Error ? err.message : String(err);
      return { retryable: true, error: new HttpError(`Network error: ${message}`) };
    }

    if (res.status === 304) {
      await res.body?.cancel();
      return { result: { status: "not_modified" }, retryable: false };
    }
    if (res.status >= 200 && res.status < 300) {
      try {
        const text = await readCapped(res, maxBytes);
        return {
          result: {
            status: "ok",
            etag: res.headers.get("etag"),
            data: json ? JSON.parse(text) : text,
          },
          retryable: false,
        };
      } catch (err) {
        if (err instanceof HttpError) return { retryable: false, error: err };
        if (options.signal?.aborted) throw new HttpError("Aborted");
        const message = err instanceof Error ? err.message : String(err);
        // Timeouts while streaming are transient; invalid JSON is not
        return {
          retryable: !(err instanceof SyntaxError),
          error: new HttpError(`Invalid response: ${message}`),
        };
      }
    }

    await res.body?.cancel();
    const error = new HttpError(`HTTP ${res.status} for ${url}`, res.status);
    if (res.status === 429 || res.status >= 500) {
      return {
        retryable: true,
        error,
        waitMs: retryAfterMs(res.headers.get("retry-after")) ?? undefined,
      };
    }
    return { retryable: false, error };
  };

  const get = async (url: string, options: GetOptions, json: boolean): Promise<JsonResult> => {
    const first = await attempt(url, options, json);
    if (first.result) return first.result;
    if (!first.retryable) throw first.error;
    const waitMs =
      first.waitMs !== undefined
        ? Math.min(first.waitMs, HTTP_MAX_RETRY_AFTER_MS)
        : 1000 + random() * 2000;
    await sleep(waitMs, options.signal).catch(() => {
      throw new HttpError("Aborted");
    });
    const second = await attempt(url, options, json);
    if (second.result) return second.result;
    throw second.error;
  };

  return {
    getJson: (url, options = {}) => get(url, options, true),
    getText: async (url, options = {}) => (await get(url, options, false)) as TextResult,
  };
};
