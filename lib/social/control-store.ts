import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { type Database, getDatabase } from "@/lib/db/client";
import { auditEvent, socialChannelControl } from "@/lib/db/schema";

import {
  applySocialControlChange,
  type SocialControlRecord,
  socialControlChangeSchema,
} from "./control-record";

export type SocialChannelControlSummary = SocialControlRecord & {
  id: string;
  channelRef: string;
  accountRef: string;
  changedAt: Date;
};

/** Persists a human-evidenced enable/pause/resume decision and append-only audit event atomically. */
export async function saveSocialChannelControl(
  input: unknown,
  database: Database = getDatabase(),
): Promise<SocialChannelControlSummary> {
  const parsed = socialControlChangeSchema.parse(input);
  return database.transaction(async (tx) => {
    const existing = await tx.query.socialChannelControl.findFirst({
      where: and(
        eq(socialChannelControl.channelRef, parsed.channelRef),
        eq(socialChannelControl.accountRef, parsed.accountRef),
      ),
    });
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
