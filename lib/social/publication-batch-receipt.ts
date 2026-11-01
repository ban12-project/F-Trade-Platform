import "server-only";
import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "@/lib/db/client";
/** Delivery changes a target's publication record, not the approved source shared
 * by other targets. Legacy single-target transitions keep their old behavior. */
export async function isBatchPublication(tx: DatabaseTransaction, publicationId: string) {
  const result = await tx.execute(sql`SELECT id FROM audit_event
    WHERE action = 'social_publication.batch_submitted'
    AND metadata->'results' @> ${JSON.stringify([{ publicationId }])}::jsonb LIMIT 1`);
  return result.rows.length !== 0;
}
