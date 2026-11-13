/** Domain errors mapped to HTTP statuses by the API. */
export class NotFoundError extends Error {
  override name = "NotFoundError";
}

export class ConflictError extends Error {
  override name = "ConflictError";
}

export class InvalidError extends Error {
  override name = "InvalidError";
}

/** Postgres unique_violation. */
export const isUniqueViolation = (err: unknown): boolean => {
  let e: unknown = err;
  // Drizzle wraps driver errors in `cause`
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    if ((e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
};
