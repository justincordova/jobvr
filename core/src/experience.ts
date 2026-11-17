const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const NUM = String.raw`(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*\(\d{1,2}\))?`;

/**
 * One alternation, so a range like "2-12+ years" is a single match:
 * - "3+ years of experience", "2-5 years of professional software experience",
 *   "five (5) years of progressive ... experience" (at most 6 words between
 *   "years" and "experience", all in one sentence, so "5 years ago we ... experience"
 *   can't match);
 *   Each word matches exactly one way (the lookahead requires a letter) so a run of
 *   long words can't backtrack exponentially.
 * - "2+ years working with", "4+ years of professional", "6+ years in Solutions
 *   Architecture", "3+ years on the investment team" (only with a "+").
 */
const MENTION = new RegExp(
  String.raw`\b${NUM}\s*(?:(\+|plus)\s*)?(?:(?:-|to)\s*\d{1,2}\s*\+?\s*)?(?:or more\s+)?years?'?\s+(?:of\s+)?(?:(?:(?=[\w/&'#+.-]*[a-z])(?:[\w/&'#+-]|\.(?=\w))+,?\s+){0,6}?(?:experience|exp)\b|(?<=\+\s*years?\s+(?:of\s+)?)(?:working|building|writing|developing|shipping|professional|industry|in|on)\b)`,
  "gi",
);

/** Text just before a mention that makes it something other than a requirement. */
const NOT_A_REQUIREMENT_BEFORE = [
  // A degree alternative: "BS in CS or 4 years of experience" (but not
  // "(or equivalent practical experience) - 5+ years", a separate bullet)
  /\bor\s+(?:[a-z']+\s+){0,3}$/,
  // The company talking about itself: "our founders have 10+ years of experience"
  /\b(?:founders?|our (?:team|company|leadership)|we've been|we have been)\b[^.;:\n]{0,40}$/,
];

const toNumber = (raw: string) => WORDS[raw.toLowerCase()] ?? Number.parseInt(raw, 10);

const normalize = (description: string) =>
  description
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ");

/** Each experience requirement in a description, in order, with the phrase that matched. */
export const experienceMentions = (description: string): { years: number; phrase: string }[] => {
  const text = normalize(description);
  const out: { years: number; phrase: string }[] = [];
  for (const m of text.matchAll(MENTION)) {
    const [phrase, raw] = m;
    if (!raw || /\bequivalent\b/i.test(phrase)) continue;
    const before = text.slice(Math.max(0, m.index - 60), m.index).toLowerCase();
    if (NOT_A_REQUIREMENT_BEFORE.some((re) => re.test(before))) continue;
    const years = toNumber(raw);
    if (!Number.isFinite(years) || years > 20) continue;
    out.push({ years, phrase });
  }
  return out;
};

/**
 * Years of experience a job description asks for, or null when it names none.
 * The first requirement is the headline one ("Minimum of 5 years building
 * software; minimum of 2 years focused on security" is 5; "3+ years required,
 * 5+ preferred" is 3).
 */
export const requiredYears = (description: string): number | null =>
  experienceMentions(description)[0]?.years ?? null;
