import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./db/client";
import { withAdvisoryLock } from "./lock";
import { createTestDatabase } from "./testing/db";

let database: Database;

beforeEach(async () => {
  database = await createTestDatabase();
});

afterEach(async () => {
  await database.close();
});

describe("withAdvisoryLock", () => {
  it("survives its connection being killed mid-run and frees the lock", async () => {
    const errors: Error[] = [];
    const result = await withAdvisoryLock(
      database.pool,
      42,
      async () => {
        // What a Postgres restart looks like to the lock's connection
        await database.pool.query(
          "SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND objid = 42",
        );
        await new Promise((r) => setTimeout(r, 100));
        return "done";
      },
      (err) => errors.push(err),
    );
    expect(result).toEqual({ acquired: true, value: "done" });
    expect(errors.length).toBeGreaterThan(0);
    // The broken client was destroyed and the lock went with its session
    const again = await withAdvisoryLock(database.pool, 42, async () => "again");
    expect(again).toEqual({ acquired: true, value: "again" });
  });
});
