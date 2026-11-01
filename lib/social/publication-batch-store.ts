import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { type Database, getDatabase } from "@/lib/db/client";
import { auditEvent } from "@/lib/db/schema";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";
import { submitFacebookMediaPublication } from "./facebook-media-store";
import {
  authorizeSocialActor,
  parseSocialProjectIdentity,
  type SocialProjectIdentity,
} from "./human-write-access";
import { type PublicationBatchResult, publicationBatchSchema } from "./publication-batch-schema";
import { submitControlledPublication } from "./publication-store";
import { assertPublishingAccountReady } from "./publishing-account-store";

export async function submitPublicationBatch(
  input: unknown,
  identityInput: SocialProjectIdentity,
  database: Database = getDatabase(),
) {
  const value = publicationBatchSchema.parse(input);
  const identity = parseSocialProjectIdentity(identityInput, value.content.projectId);
  const targets = [...value.targets].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
  const digest = createHash("sha256")
    .update(JSON.stringify({ ...value, targets }))
    .digest("hex");
  return database.transaction(async (tx) => {
    await assertWorkspaceProjectAccess(value.content.projectId, identity.actorId, "write", tx);
    await authorizeSocialActor(
      tx,
      identity,
      [value.content.format === "text" ? "content:write" : "content:review"],
      value.content.format !== "text",
    );
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`publication-batch:${identity.actorId}:${value.batchId}`}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.subjectId, value.batchId),
          eq(auditEvent.action, "social_publication.batch_submitted"),
          eq(auditEvent.actorId, identity.actorId),
        ),
      );
    if (existing) {
      if (existing.metadata?.digest !== digest)
        throw new Error("同一批次的内容或账号发生变化，请重新预览后确认。");
      return existing.metadata.results as PublicationBatchResult[];
    }
    // Global node order also covers batches containing different accounts on
    // the same nodes; per-account ordering alone can invert node locks.
    await tx.execute(sql`SELECT n.id FROM browser_fleet_node n
      JOIN browser_fleet_binding b ON b.node_id = n.id
      WHERE ${sql.join(
        targets.map(
          (t) => sql`(b.channel_ref = ${t.channelRef} AND b.account_ref = ${t.accountRef})`,
        ),
        sql` OR `,
      )}
      ORDER BY n.id FOR SHARE OF n`);
    // Lock every target before creating any work. A stale target rolls back the
    // whole confirmation; workers cannot observe a silently reduced batch.
    for (const target of targets) await assertPublishingAccountReady(tx, target, identity.actorId);
    const results: PublicationBatchResult[] = [];
    for (const target of targets) {
      const saved =
        value.content.format === "text"
          ? await submitControlledPublication(
              {
                ...value.content,
                ...target,
                confirmationRef: `source-confirmation-${value.batchId}`,
              },
              identity,
              tx as unknown as Database,
            )
          : await submitFacebookMediaPublication(
              { ...value.content, ...target, confirm: true },
              identity,
              tx as unknown as Database,
            );
      results.push({
        ...target,
        publicationId: "publicationId" in saved ? saved.publicationId : saved.id,
      });
    }
    for (const target of targets) await assertPublishingAccountReady(tx, target, identity.actorId);
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      actorType: "human",
      actorId: identity.actorId,
      action: "social_publication.batch_submitted",
      subjectType: "publication_batch",
      subjectId: value.batchId,
      metadata: { digest, audience: "Public", results },
      occurredAt: new Date(),
    });
    return results;
  });
}
