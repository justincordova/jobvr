import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  parseStoredSettings,
  SettingsPatchSchema,
  SettingsSchema,
} from "./settings";

describe("settings", () => {
  it("defaults are valid", () => {
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it("fills missing fields with defaults and drops invalid ones", () => {
    const parsed = parseStoredSettings({ maxJobAgeHours: 48, pollEveryMinutes: 1, unknown: 1 });
    expect(parsed.maxJobAgeHours).toBe(48);
    expect(parsed.pollEveryMinutes).toBe(DEFAULT_SETTINGS.pollEveryMinutes);
    expect(parsed).not.toHaveProperty("unknown");
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("converts the old enabled-sources list, so a source added later starts on", () => {
    expect(
      parseStoredSettings({ enabledSources: ["greenhouse", "ashby", "simplify"] }).disabledSources,
    ).toEqual(["lever"]);
    expect(
      parseStoredSettings({ enabledSources: ["greenhouse"], disabledSources: [] }).disabledSources,
    ).toEqual([]);
  });

  it("rejects duplicate labels, no enabled location, and a removed Remote-US entry", () => {
    const base = DEFAULT_SETTINGS.locations;
    const dup = [...base, { label: "nj", aliases: ["x"], enabled: true }];
    expect(SettingsPatchSchema.safeParse({ locations: dup }).success).toBe(false);
    const none = base.map((l) => ({ ...l, enabled: false }));
    expect(SettingsPatchSchema.safeParse({ locations: none }).success).toBe(false);
    const noRemote = base.filter((l) => !l.builtin);
    expect(SettingsPatchSchema.safeParse({ locations: noRemote }).success).toBe(false);
    const renamed = base.map((l) => (l.builtin ? { ...l, label: "Remote" } : l));
    expect(SettingsPatchSchema.safeParse({ locations: renamed }).success).toBe(false);
    const noAliases = [...base, { label: "Boston", aliases: [], enabled: true }];
    expect(SettingsPatchSchema.safeParse({ locations: noAliases }).success).toBe(false);
  });

  it("validates ranges and quiet hours", () => {
    expect(SettingsPatchSchema.safeParse({ maxJobAgeHours: 169 }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ pushEveryMinutes: 4 }).success).toBe(false);
    expect(
      SettingsPatchSchema.safeParse({ quietHours: { start: "24:00", end: "07:00" } }).success,
    ).toBe(false);
    expect(SettingsPatchSchema.safeParse({ roleKeywords: [] }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ excludeKeywords: [] }).success).toBe(true);
  });
});
