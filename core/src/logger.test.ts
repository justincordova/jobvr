import { describe, expect, it } from "vitest";
import { HttpError } from "./http";
import { createConsoleLogger, errorFields, formatDuration } from "./logger";

const capture = (level: "debug" | "info" = "info", hide?: string[]) => {
  const lines: string[] = [];
  const logger = createConsoleLogger({
    level,
    color: false,
    hide,
    write: (line) => lines.push(line),
    now: () => new Date(2026, 10, 16, 22, 30, 5, 42),
  });
  return { logger, lines };
};

describe("console logger", () => {
  it("prints one readable line: time, level, module, message, then fields", () => {
    const { logger, lines } = capture();
    logger
      .child({ module: "poll" })
      .info({ listings: 120, note: "two words" }, "Ramp (Ashby) · +2 new");
    expect(lines).toEqual([
      '22:30:05.042 INFO  poll · Ramp (Ashby) · +2 new  listings=120 note="two words"',
    ]);
  });

  it("drops lines below the level and hides chosen fields", () => {
    const { logger, lines } = capture("info", ["target"]);
    logger.debug({}, "not shown");
    logger.warn({ target: "company:1", status: 404 }, "Air (Greenhouse) failed (1 in a row)");
    expect(lines).toEqual(["22:30:05.042 WARN  Air (Greenhouse) failed (1 in a row)  status=404"]);
  });

  it("prints an error's stack indented under the line", () => {
    const { logger, lines } = capture();
    logger.error({ err: new Error("boom") }, "saving results failed");
    expect(lines[0]).toMatch(
      /^22:30:05\.042 ERROR saving results failed\n {4}Error: boom\n {8}at /,
    );
  });
});

describe("errorFields", () => {
  it("keeps expected failures to one line and bugs in full", () => {
    expect(errorFields(new HttpError("HTTP 404 for https://x", 404))).toEqual({
      error: "HTTP 404 for https://x",
      status: 404,
    });
    const bug = new TypeError("x is undefined");
    expect(errorFields(bug)).toEqual({ err: bug });
  });
});

describe("formatDuration", () => {
  it("picks a readable unit", () => {
    expect(formatDuration(312.4)).toBe("312 ms");
    expect(formatDuration(6104)).toBe("6.1 s");
    expect(formatDuration(300_000)).toBe("5 min");
  });
});
