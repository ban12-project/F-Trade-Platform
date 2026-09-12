import { randomUUID } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { facebookAccountRuntime, facebookRequestReceipt } from "@/lib/db/facebook-runtime-schema";
import { auditEvent } from "@/lib/db/schema";
import { facebookProxySecretSchema } from "@/lib/social/facebook-account-forms";
import { verifyProxyBootstrap } from "@/lib/social/facebook-proxy-protocol";
import {
  configuredFacebookKeyring,
  decryptFacebookCredential,
} from "@/lib/social/facebook-vault-crypto";
import { configuredFacebookWorkerScope } from "@/lib/social/facebook-worker-protocol";
export async function POST(request: Request) {
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    if (process.env.SOCIAL_FACEBOOK_WORKER_ENABLED !== "1" || !request.body)
      throw new Error("disabled");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          throw new Error("request_too_large");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const scope = configuredFacebookWorkerScope();
    const requestBody = verifyProxyBootstrap(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
      scope,
      process.env.FACEBOOK_PROXY_BOOTSTRAP_KEY ?? "",
    );
    const proxy = await getDatabase().transaction(async (tx) => {
      const accepted = await tx
        .insert(facebookRequestReceipt)
        .values({ requestId: requestBody.requestId, expiresAt: new Date(Date.now() + 60_000) })
        .onConflictDoNothing()
        .returning({ id: facebookRequestReceipt.requestId });
      if (!accepted.length) throw new Error("request_replayed");
      await tx
        .delete(facebookRequestReceipt)
        .where(lt(facebookRequestReceipt.expiresAt, new Date()));
      const [row] = await tx
        .select()
        .from(facebookAccountRuntime)
        .where(eq(facebookAccountRuntime.accountRef, scope.accountRef));
      if (!row?.proxyCiphertext || row.channelRef !== scope.channelRef)
        throw new Error("proxy_missing");
      await tx.insert(auditEvent).values({
        id: randomUUID(),
        action: "facebook_credentials.proxy_used",
        actorType: "system",
        actorId: scope.workerId,
        subjectType: "facebook_account",
        subjectId: scope.accountRef,
        metadata: {},
        occurredAt: new Date(),
      });
      return facebookProxySecretSchema.parse(
        decryptFacebookCredential(row.proxyCiphertext, scope, "proxy", configuredFacebookKeyring()),
      );
    });
    return reply({ proxy });
  } catch {
    return reply({ error: "proxy_configuration_unavailable" }, 403);
  }
}
