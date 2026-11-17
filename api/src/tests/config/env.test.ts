import { describe, expect, it } from "vitest";
import { EnvSchema } from "@/config/env";

describe("EnvSchema", () => {
  it("applies defaults and parses typed values", () => {
    const env = EnvSchema.parse({ PORT: "8080", TRUST_PROXY: "true" });
    expect(env.PORT).toBe(8080);
    expect(env.TRUST_PROXY).toBe(true);
    expect(env.NODE_ENV).toBe("development");
    expect(env.ALLOWED_ORIGINS).toEqual(["http://localhost:3000", "http://localhost:5173"]);
  });

  it("accepts an empty ALLOWED_ORIGINS (production is same-origin only)", () => {
    expect(EnvSchema.parse({ ALLOWED_ORIGINS: "" }).ALLOWED_ORIGINS).toEqual([]);
  });

  it("splits and trims ALLOWED_ORIGINS", () => {
    const env = EnvSchema.parse({ ALLOWED_ORIGINS: "https://a.com, https://b.com:8443" });
    expect(env.ALLOWED_ORIGINS).toEqual(["https://a.com", "https://b.com:8443"]);
  });

  it("explains a DATABASE_URL broken by special characters in the password", () => {
    const r = EnvSchema.safeParse({ DATABASE_URL: "postgres://jobvr:ab/c#d@postgres:5432/jobvr" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain("openssl rand -hex 32");
  });

  it("requires an http(s) ntfy URL with a topic", () => {
    expect(EnvSchema.safeParse({ NTFY_URL: "https://ntfy.sh/" }).success).toBe(false);
    expect(EnvSchema.safeParse({ NTFY_URL: "ntfy.sh/topic" }).success).toBe(false);
    expect(EnvSchema.safeParse({ NTFY_URL: "ftp://ntfy.sh/topic" }).success).toBe(false);
    expect(EnvSchema.parse({ NTFY_URL: " https://ntfy.sh/abc123 " }).NTFY_URL).toBe(
      "https://ntfy.sh/abc123",
    );
    expect(EnvSchema.parse({ NTFY_URL: "" }).NTFY_URL).toBeUndefined();
  });

  it("rejects invalid values with issues instead of throwing", () => {
    const result = EnvSchema.safeParse({
      PORT: "70000",
      TRUST_PROXY: "yes",
      ALLOWED_ORIGINS: "https://a.com/,not-a-url",
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining(["PORT", "TRUST_PROXY", "ALLOWED_ORIGINS.0", "ALLOWED_ORIGINS.1"]),
    );
  });
});
