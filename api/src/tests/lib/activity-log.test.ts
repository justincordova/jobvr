import { describe, expect, it } from "vitest";
import { createActivityLog, createRedactor, secretsFromEnv } from "@/lib/activity-log";

const line = (fields: Record<string, unknown>) =>
  `${JSON.stringify({ level: "info", time: "2026-11-18T12:00:00.000Z", ...fields })}\n`;

describe("activity log", () => {
  it("keeps the message, module and error message of info-and-above lines", () => {
    const log = createActivityLog();
    log.write(line({ module: "poll", msg: "poll finished", targets: 157 }));
    log.write(line({ level: "warn", msg: "Air (Greenhouse) failed", error: "HTTP 404" }));
    log.write(
      line({ level: "error", msg: "notify crashed", err: { message: "boom", stack: "at x" } }),
    );
    log.write(line({ level: "debug", msg: "GET /api/jobs 200" }));
    log.write("not json");

    expect(log.list(0, 10)).toEqual([
      {
        seq: 1,
        time: "2026-11-18T12:00:00.000Z",
        level: "info",
        module: "poll",
        msg: "poll finished",
        error: null,
      },
      expect.objectContaining({ seq: 2, level: "warn", module: null, error: "HTTP 404" }),
      expect.objectContaining({ seq: 3, level: "error", error: "boom" }),
    ]);
    expect(log.latestSeq).toBe(3);
  });

  it("returns entries after the cursor, newest kept when over the limit", () => {
    const log = createActivityLog();
    for (let i = 1; i <= 5; i++) log.write(line({ msg: `line ${i}` }));
    expect(log.list(3, 10).map((e) => e.msg)).toEqual(["line 4", "line 5"]);
    expect(log.list(0, 2).map((e) => e.msg)).toEqual(["line 4", "line 5"]);
    expect(log.list(5, 10)).toEqual([]);
  });

  it("drops the oldest entries past its capacity", () => {
    const log = createActivityLog({ capacity: 3 });
    for (let i = 1; i <= 5; i++) log.write(line({ msg: `line ${i}` }));
    expect(log.list(0, 10).map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it("caps long messages", () => {
    const log = createActivityLog();
    log.write(line({ msg: "x".repeat(5000) }));
    expect(log.list(0, 1)[0]?.msg.length).toBeLessThanOrEqual(2001);
  });
});

describe("redaction", () => {
  const env = {
    NTFY_URL: "https://ntfy.example.com/b3ceb662aceb3a98b8a6e4c29fbac0f6",
    DATABASE_URL: "postgres://jobvr:5f2c9d0e8a7b6c5d4e3f2a1b@postgres:5432/jobvr",
  };
  const redact = createRedactor(secretsFromEnv(env));

  it("removes the configured ntfy URL, its topic and the database password", () => {
    expect(redact(`push failed: POST ${env.NTFY_URL} 500`)).toBe(
      "push failed: POST [redacted] 500",
    );
    expect(redact("topic b3ceb662aceb3a98b8a6e4c29fbac0f6 unreachable")).toBe(
      "topic [redacted] unreachable",
    );
    expect(redact("password 5f2c9d0e8a7b6c5d4e3f2a1b rejected")).toBe(
      "password [redacted] rejected",
    );
  });

  it("removes credentials in any URL, Tailscale keys and ntfy.sh topics", () => {
    const anyKey = createRedactor([]);
    expect(anyKey("connect postgres://app:hunter2hunter2@db:5432/x failed")).toBe(
      "connect postgres://app:[redacted]@db:5432/x failed",
    );
    // Assembled at runtime so secret scanners don't flag the fake key
    const fakeKey = ["tskey", "auth", "kAbC123", "XyZ"].join("-");
    expect(anyKey(`key ${fakeKey} in use`)).toBe("key [redacted] in use");
    expect(anyKey("POST https://ntfy.sh/mysecrettopic?x=1")).toBe(
      "POST https://ntfy.sh/[redacted]?x=1",
    );
  });

  it("leaves short secrets alone (they would blank ordinary words)", () => {
    const dev = createRedactor(
      secretsFromEnv({ DATABASE_URL: "postgres://jobvr:jobvr@localhost/jobvr" }),
    );
    expect(dev("jobvr listening")).toBe("jobvr listening");
  });

  it("scrubs entries as they are stored", () => {
    const log = createActivityLog({ secrets: secretsFromEnv(env) });
    log.write(line({ level: "error", msg: `push to ${env.NTFY_URL} failed`, error: env.NTFY_URL }));
    expect(log.list(0, 1)[0]).toMatchObject({
      msg: "push to [redacted] failed",
      error: "[redacted]",
    });
  });
});
