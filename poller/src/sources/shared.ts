import { HttpError, type ProbeCtx } from "@jobvr/core";

/** Location appended by adapters to remote US jobs (matched by the Remote-US rule). */
export const REMOTE_US = "Remote - US";

/** GET a board for `discover`/`seed`: 404 means "no board with that slug". */
export const probeBoard = async (
  url: string,
  ctx: ProbeCtx,
  count: (data: unknown) => number,
): Promise<{ found: boolean; jobCount: number }> => {
  try {
    const res = await ctx.http.getJson(url, { signal: ctx.signal });
    return { found: true, jobCount: res.status === "ok" ? count(res.data) : 0 };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return { found: false, jobCount: 0 };
    throw err;
  }
};
