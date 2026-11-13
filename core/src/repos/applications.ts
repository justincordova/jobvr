import { and, desc, eq } from "drizzle-orm";
import type { ApplicationStatus } from "../constants";
import type { DbOrTx } from "../db/client";
import { type ApplicationRow, applications, jobs } from "../db/schema";
import { NotFoundError } from "../errors";

export interface ApplicationInput {
  companyName: string;
  title: string;
  url?: string | null;
  status?: ApplicationStatus;
  appliedAt?: Date;
  notes?: string | null;
}

export interface ApplicationPatch {
  status?: ApplicationStatus;
  notes?: string | null;
  appliedAt?: Date;
}

export const listApplications = (db: DbOrTx): Promise<ApplicationRow[]> =>
  db.select().from(applications).orderBy(desc(applications.appliedAt));

/** Manual entry (no linked job), e.g. a role found on Workday. */
export const createApplication = async (
  db: DbOrTx,
  input: ApplicationInput,
  now: Date,
): Promise<ApplicationRow> => {
  const [row] = await db
    .insert(applications)
    .values({
      companyName: input.companyName.trim(),
      title: input.title.trim(),
      url: input.url?.trim() || null,
      status: input.status ?? "applied",
      appliedAt: input.appliedAt ?? now,
      notes: input.notes?.trim() || null,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
};

export const updateApplication = async (
  db: DbOrTx,
  id: string,
  patch: ApplicationPatch,
  now: Date,
): Promise<ApplicationRow> => {
  const [row] = await db
    .update(applications)
    .set({
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.notes !== undefined && { notes: patch.notes?.trim() || null }),
      ...(patch.appliedAt !== undefined && { appliedAt: patch.appliedAt }),
      updatedAt: now,
    })
    .where(eq(applications.id, id))
    .returning();
  if (!row) throw new NotFoundError("Application not found");
  return row;
};

/** Deletes an application; a linked job in state `applied` returns to `new`. */
export const deleteApplication = (db: DbOrTx, id: string, now: Date): Promise<void> =>
  db.transaction(async (tx) => {
    const [row] = await tx.delete(applications).where(eq(applications.id, id)).returning();
    if (!row) throw new NotFoundError("Application not found");
    if (row.jobId) {
      await tx
        .update(jobs)
        .set({ state: "new", updatedAt: now })
        .where(and(eq(jobs.id, row.jobId), eq(jobs.state, "applied")));
    }
  });
