import { describe, expect, it } from "vitest";
import { inQuietHours, isDue, startOfEasternDay } from "./schedule";

describe("isDue", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  it("tolerates 60 s of tick jitter", () => {
    expect(isDue(null, 15 * 60_000, now)).toBe(true);
    expect(isDue(ago(14 * 60_000), 15 * 60_000, now)).toBe(true);
    expect(isDue(ago(13 * 60_000 + 59_000), 15 * 60_000, now)).toBe(false);
  });
});

describe("quiet hours (America/New_York)", () => {
  const q = { start: "23:00", end: "07:00" };
  it("wraps midnight, half-open", () => {
    // EST (UTC-5) in November
    expect(inQuietHours(new Date("2026-11-13T04:00:00Z"), q)).toBe(true); // 23:00
    expect(inQuietHours(new Date("2026-11-13T03:59:00Z"), q)).toBe(false); // 22:59
    expect(inQuietHours(new Date("2026-11-13T11:59:00Z"), q)).toBe(true); // 06:59
    expect(inQuietHours(new Date("2026-11-13T12:00:00Z"), q)).toBe(false); // 07:00
  });

  it("handles non-wrapping ranges and start = end", () => {
    const day = { start: "09:00", end: "17:00" };
    expect(inQuietHours(new Date("2026-11-13T15:00:00Z"), day)).toBe(true); // 10:00
    expect(inQuietHours(new Date("2026-11-13T22:00:00Z"), day)).toBe(false); // 17:00
    expect(inQuietHours(new Date("2026-11-13T15:00:00Z"), { start: "08:00", end: "08:00" })).toBe(
      false,
    );
  });

  it("follows DST", () => {
    // July is EDT (UTC-4): 03:30Z = 23:30 local
    expect(inQuietHours(new Date("2026-07-15T03:30:00Z"), q)).toBe(true);
    expect(inQuietHours(new Date("2026-07-15T11:30:00Z"), q)).toBe(false); // 07:30 local
  });
});

describe("startOfEasternDay", () => {
  it("returns local midnight in standard and daylight time", () => {
    expect(startOfEasternDay(new Date("2026-11-13T03:00:00Z"))).toEqual(
      new Date("2026-11-12T05:00:00Z"),
    );
    expect(startOfEasternDay(new Date("2026-07-15T12:00:00Z"))).toEqual(
      new Date("2026-07-15T04:00:00Z"),
    );
    // DST starts 2026-03-08 at 02:00 local; midnight is still EST
    expect(startOfEasternDay(new Date("2026-03-08T18:00:00Z"))).toEqual(
      new Date("2026-03-08T05:00:00Z"),
    );
  });
});
