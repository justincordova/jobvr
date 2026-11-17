/** Lowercase; every character other than a-z / 0-9 becomes a separator. */
export const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** True when `needle` appears as a contiguous run inside `haystack`. */
export const containsSequence = (
  haystack: readonly string[],
  needle: readonly string[],
): boolean => {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
};

/**
 * Token-based keyword match: `sr.` matches "Sr", `full stack` matches
 * "Full-Stack". The last word may also be plural: `intern` matches "2027
 * Interns", `new grad` matches "New Grads".
 */
export const matchesKeyword = (textTokens: readonly string[], keyword: string): boolean => {
  const needle = tokenize(keyword);
  const last = needle.at(-1);
  if (containsSequence(textTokens, needle)) return true;
  if (!last || !/^[a-z]{2,}$/.test(last)) return false;
  return containsSequence(textTokens, [...needle.slice(0, -1), `${last}s`]);
};

export const matchesAnyKeyword = (textTokens: readonly string[], keywords: readonly string[]) =>
  keywords.some((k) => matchesKeyword(textTokens, k));

const COMPANY_STOP_TOKENS = new Set([
  "the",
  "inc",
  "llc",
  "ltd",
  "corp",
  "corporation",
  "co",
  "company",
]);

/** "The Regal Co., Inc." → "regal"; "AT&T" → "at and t". */
export const normalizeCompanyName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !COMPANY_STOP_TOKENS.has(t))
    .join(" ");

const KEPT_QUERY_PARAMS = ["gh_jid", "token"];

/**
 * Normalized URL used as an exact-dedupe identity key. Null for URLs that
 * can't identify a single posting (fewer than 2 path segments).
 */
export const urlKey = (raw: string): string | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/(apply|application)$/i, "");
  const segments = path.split("/").filter(Boolean);
  const kept = KEPT_QUERY_PARAMS.flatMap((p) => {
    const v = url.searchParams.get(p);
    return v ? [`${p}=${v}`] : [];
  });
  if (segments.length < 2) return null;
  return `${url.protocol}//${host}/${segments.join("/")}${kept.length ? `?${kept.join("&")}` : ""}`;
};

/** Jaccard similarity of two titles' token sets. */
export const titleJaccard = (a: string, b: string): number => {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
};
