import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { type Database, getDatabase } from "@/lib/db/client";
import { auditEvent, socialChannelControl } from "@/lib/db/schema";

import {
  applySocialControlChange,
  type SocialControlRecord,
  socialControlChangeSchema,
} from "./control-record";
import {
  assertSocialAuthorizationAlive,
  authorizeSocialActor,
  parseSocialActorIdentity,
  type SocialActorIdentity,
  SocialHumanAccessError,
} from "./human-write-access";

export type SocialChannelControlSummary = SocialControlRecord & {
  id: string;
  channelRef: string;
  accountRef: string;
  changedAt: Date;
};

/** Persists a human-evidenced enable/pause/resume decision and append-only audit event atomically. */
export async function saveSocialChannelControl(
  input: unknown,
  identityInput: SocialActorIdentity,
  database: Database = getDatabase(),
): Promise<SocialChannelControlSummary> {
  const parsed = socialControlChangeSchema.parse(input);
  const identity = parseSocialActorIdentity(identityInput);
  if (parsed.actorId !== identity.actorId) throw new SocialHumanAccessError();
  return database.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([parsed.channelRef, parsed.accountRef])}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(socialChannelControl)
      .where(
        and(
          eq(socialChannelControl.channelRef, parsed.channelRef),
          eq(socialChannelControl.accountRef, parsed.accountRef),
        ),
      )
      .for("update");
    const expiresAt = await authorizeSocialActor(tx, identity, ["settings:manage"]);
    const current: SocialControlRecord = existing
      ? {
          enabled: existing.enabled,
          circuitStatus: existing.circuitStatus === "active" ? "active" : "paused",
          pauseReason: existing.pauseReason,
          pauseEvidenceRef: existing.pauseEvidenceRef,
        }
      : {
          enabled: false,
          circuitStatus: "paused",
          pauseReason: "not_enabled",
          pauseEvidenceRef: null,
        };
    const next = applySocialControlChange(current, parsed);
    const now = new Date();
    const values = {
      id: existing?.id ?? randomUUID(),
      channelRef: parsed.channelRef,
      accountRef: parsed.accountRef,
      ...next,
      changedBy: parsed.actorId,
      changedAt: now,
    };
    const [saved] = await tx
      .insert(socialChannelControl)
      .values(values)
      .onConflictDoUpdate({
        target: [socialChannelControl.channelRef, socialChannelControl.accountRef],
        set: values,
      })
      .returning();
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: `social_channel_${parsed.action}`,
      actorType: "human",
      actorId: parsed.actorId,
      subjectType: "social_channel_control",
      subjectId: saved.id,
      metadata: {
        channel_ref: parsed.channelRef,
        account_ref: parsed.accountRef,
        evidence_ref: parsed.evidenceRef,
        enabled: next.enabled,
        circuit_status: next.circuitStatus,
      },
      occurredAt: now,
    });
    assertSocialAuthorizationAlive(expiresAt);
    return {
      id: saved.id,
      channelRef: saved.channelRef,
      accountRef: saved.accountRef,
      enabled: saved.enabled,
      circuitStatus: saved.circuitStatus === "active" ? "active" : "paused",
      pauseReason: saved.pauseReason,
      pauseEvidenceRef: saved.pauseEvidenceRef,
      changedAt: saved.changedAt,
    };
  });
}
