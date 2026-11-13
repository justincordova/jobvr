import type pg from "pg";

export type LockResult<T> = { acquired: false } | { acquired: true; value: T };

/**
 * Runs `fn` while holding a session-level advisory lock on a dedicated
 * connection. Returns `{ acquired: false }` immediately if another process holds
 * it. The lock is released when `fn` ends or the connection drops.
 */
export const withAdvisoryLock = async <T>(
  pool: pg.Pool,
  key: number,
  fn: () => Promise<T>,
): Promise<LockResult<T>> => {
  const client = await pool.connect();
  let broken = false;
  try {
    const res = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [key]);
    if (!res.rows[0]?.ok) return { acquired: false };
    try {
      return { acquired: true, value: await fn() };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]).catch(() => {
        broken = true;
      });
    }
  } finally {
    // A connection whose unlock failed is destroyed so the lock can't leak
    client.release(broken);
  }
};
