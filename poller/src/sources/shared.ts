import { BOARD_TIMEOUT_MS, HttpError, type ProbeCtx } from "@jobvr/core";

/** Location appended by adapters to remote US jobs (matched by the Remote-US rule). */
export const REMOTE_US = "Remote - US";

/** A URL path segment decoded, or null when it's malformed ("acme%E0" would throw). */
export const decodeSlug = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/**
 * The board slug in a board or job link on one of `hosts` (the first path
 * segment, as in `jobs.lever.co/acme` or `jobs.lever.co/acme/<id>`), or null.
 */
export const boardSlugOn = (raw: string, hosts: ReadonlySet<string>): string | null => {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (!hosts.has(url.hostname.toLowerCase())) return null;
  // Greenhouse's embedded board: /embed/job_board?for=acme
  const embedded = url.searchParams.get("for");
  if (embedded) return embedded;
  const [first] = url.pathname.split("/").filter(Boolean);
  return first && first !== "embed" ? decodeSlug(first) : null;
};

/** GET a board for `discover`/`seed`: 404 means "no board with that slug". */
export const probeBoard = async (
  url: string,
  ctx: ProbeCtx,
  count: (data: unknown) => number,
): Promise<{ found: boolean; jobCount: number }> => {
  try {
    const res = await ctx.http.getJson(url, { signal: ctx.signal, timeoutMs: BOARD_TIMEOUT_MS });
    return { found: true, jobCount: res.status === "ok" ? count(res.data) : 0 };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return { found: false, jobCount: 0 };
    throw err;
  }
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  ndash: "-",
  mdash: "-",
};

const decodeEntities = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
    const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
  });

/** Plain text from an HTML fragment (entities may be escaped once more, as Greenhouse does). */
export const htmlToText = (html: string): string =>
  decodeEntities(
    decodeEntities(html)
      .replace(/<(br|\/p|\/li|\/h\d|\/div)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
