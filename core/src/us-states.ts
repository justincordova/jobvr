/** US state (and DC) codes keyed by lowercase full name. */
export const US_STATES: Record<string, string> = {
  alabama: "al",
  alaska: "ak",
  arizona: "az",
  arkansas: "ar",
  california: "ca",
  colorado: "co",
  connecticut: "ct",
  delaware: "de",
  "district of columbia": "dc",
  florida: "fl",
  georgia: "ga",
  hawaii: "hi",
  idaho: "id",
  illinois: "il",
  indiana: "in",
  iowa: "ia",
  kansas: "ks",
  kentucky: "ky",
  louisiana: "la",
  maine: "me",
  maryland: "md",
  massachusetts: "ma",
  michigan: "mi",
  minnesota: "mn",
  mississippi: "ms",
  missouri: "mo",
  montana: "mt",
  nebraska: "ne",
  nevada: "nv",
  "new hampshire": "nh",
  "new jersey": "nj",
  "new mexico": "nm",
  "new york": "ny",
  "north carolina": "nc",
  "north dakota": "nd",
  ohio: "oh",
  oklahoma: "ok",
  oregon: "or",
  pennsylvania: "pa",
  "rhode island": "ri",
  "south carolina": "sc",
  "south dakota": "sd",
  tennessee: "tn",
  texas: "tx",
  utah: "ut",
  vermont: "vt",
  virginia: "va",
  washington: "wa",
  "west virginia": "wv",
  wisconsin: "wi",
  wyoming: "wy",
};

const CODES = new Set(Object.values(US_STATES));
const NAME_BY_CODE = new Map(Object.entries(US_STATES).map(([name, code]) => [code, name]));

/** "NJ" or "New Jersey" (any case) → "nj"; anything else → null. */
export const stateCode = (text: string): string | null => {
  const t = text.trim().toLowerCase().replace(/\./g, "");
  if (CODES.has(t)) return t;
  return US_STATES[t.replace(/\s+/g, " ")] ?? null;
};

export const stateName = (code: string): string | undefined => NAME_BY_CODE.get(code);
