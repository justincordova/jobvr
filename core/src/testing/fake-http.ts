import { type HttpClient, HttpError, type JsonResult, type TextResult } from "../http";

type Reply = JsonResult | { error: number | string } | ((etag?: string | null) => JsonResult);

/**
 * HttpClient stub keyed by URL; unknown URLs reply 404. Records every call.
 * `getText` serves the same replies (`data` should then be a string).
 */
export const fakeHttp = (replies: Record<string, Reply>) => {
  const calls: { url: string; etag?: string | null }[] = [];
  const getJson: HttpClient["getJson"] = async (url, options = {}) => {
    calls.push({ url, etag: options.etag });
    const reply = replies[url];
    if (reply === undefined) throw new HttpError(`HTTP 404 for ${url}`, 404);
    if (typeof reply === "function") return reply(options.etag);
    if ("error" in reply) {
      throw typeof reply.error === "number"
        ? new HttpError(`HTTP ${reply.error} for ${url}`, reply.error)
        : new HttpError(reply.error);
    }
    return structuredClone(reply);
  };
  const http: HttpClient = {
    getJson,
    getText: async (url, options) => (await getJson(url, options)) as TextResult,
  };
  return { http, calls };
};
