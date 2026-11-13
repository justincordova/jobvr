const DAY_MS = 86_400_000;

/** Day-precision dates count as the end of that UTC day; instants are used as-is. */
export const adjustedPostedAt = (postedAt: Date, precision: "instant" | "day"): Date => {
  if (precision === "instant") return postedAt;
  const startOfDay = Math.floor(postedAt.getTime() / DAY_MS) * DAY_MS;
  return new Date(startOfDay + DAY_MS - 1);
};

/** Effective date on insert: the earlier of first seen and the adjusted posted date. */
export const initialEffectiveAt = (firstSeenAt: Date, adjustedPosted: Date): Date =>
  adjustedPosted < firstSeenAt ? adjustedPosted : firstSeenAt;

/** On merge the effective date only ever moves earlier (a repost can't look new). */
export const mergedEffectiveAt = (current: Date, adjustedPosted: Date): Date =>
  adjustedPosted < current ? adjustedPosted : current;
