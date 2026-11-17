/** What a new grad checks first in a posting, in this order. */
const TOPICS: { topic: KeyLine["topic"]; re: RegExp }[] = [
  {
    topic: "experience",
    re: /\b(?:\d+|one|two|three|four|five)\+?\s*(?:(?:-|–|to)\s*\d+\s*)?years?\b|\bnew grad|\brecent grad|\bentry[- ]level\b/i,
  },
  {
    topic: "degree",
    re: /\b(?:bachelor'?s?|master'?s?|ph\.?\s?d|b\.?s\.?|m\.?s\.?|degree|graduat(?:e|ing|ion) (?:in|by|date))\b/i,
  },
  {
    topic: "visa",
    re: /\b(?:sponsor(?:ship)?|visa|work authori[sz]ation|authori[sz]ed to work|u\.?s\.? citizen(?:ship)?|security clearance|green card)\b/i,
  },
  {
    topic: "workplace",
    re: /\b(?:remote|hybrid|on-?site|in[- ]office|in[- ]person|relocat\w*)\b/i,
  },
  {
    topic: "pay",
    re: /\$\s?\d|\b(?:salary|base pay|pay range|compensation range|annual base)\b/i,
  },
];

export interface KeyLine {
  topic: "experience" | "degree" | "visa" | "workplace" | "pay";
  text: string;
}

const PER_TOPIC = 2;
const MAX_LINES = 8;

/** Lines and sentences of a plain-text description, trimmed to readable lengths. */
const sentences = (description: string) =>
  description
    .split(/\n+/)
    .flatMap((line) => (line.length > 280 ? line.split(/(?<=[.;!?])\s+/) : [line]))
    .map((s) => s.replace(/^[\s•·*\-–]+/, "").trim())
    .filter((s) => s.length >= 15 && s.length <= 400);

/**
 * The lines of a description worth reading before applying: years of
 * experience, degree, visa and clearance, where you work, and pay. At most two
 * per topic, eight in all, in description order within a topic.
 */
export const keyLines = (description: string | null | undefined): KeyLine[] => {
  if (!description) return [];
  const all = sentences(description);
  const seen = new Set<string>();
  const out: KeyLine[] = [];
  for (const { topic, re } of TOPICS) {
    let n = 0;
    for (const text of all) {
      if (n >= PER_TOPIC || out.length >= MAX_LINES) break;
      if (seen.has(text) || !re.test(text)) continue;
      seen.add(text);
      out.push({ topic, text });
      n++;
    }
  }
  return out;
};
