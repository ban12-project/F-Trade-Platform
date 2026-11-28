import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseTransaction } from "./db/client";
import { session, user } from "./db/schema";

export const actorSessionSchema = z.strictObject({
  actorId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
});
export const projectActorSessionSchema = actorSessionSchema.extend({ projectId: z.uuid() });

export type ActorSessionIdentity = z.infer<typeof actorSessionSchema>;
export type ProjectActorSessionIdentity = z.infer<typeof projectActorSessionSchema>;

// Hold both current rows through commit. The caller checks scope and expiry after its business locks.
export async function lockActorSession(tx: DatabaseTransaction, identity: ActorSessionIdentity) {
  const actors = await tx
    .select({ role: user.role, banned: user.banned, expiresAt: session.expiresAt })
    .from(user)
    .innerJoin(session, eq(session.userId, user.id))
    .where(and(eq(user.id, identity.actorId), eq(session.id, identity.sessionId)))
    .for("share");
  return actors.at(0);
}
