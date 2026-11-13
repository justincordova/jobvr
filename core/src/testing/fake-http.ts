import { type HttpClient, HttpError, type JsonResult } from "../http";

type Reply = JsonResult | { error: number | string } | ((etag?: string | null) => JsonResult);

/** HttpClient stub keyed by URL; unknown URLs reply 404. Records every call. */
export const fakeHttp = (replies: Record<string, Reply>) => {
  const calls: { url: string; etag?: string | null }[] = [];
  const http: HttpClient = {
    async getJson(url, options = {}) {
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
    },
  };
  return { http, calls };
};
