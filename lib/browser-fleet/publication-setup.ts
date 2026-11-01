import "server-only";
import { Sandbox } from "@vercel/sandbox";
import { getDatabase } from "../db/client";
import { publicationInspectionRuntimeOrigin } from "./publication-inspection-runtime";
import { currentInspectionAccess } from "./publication-page-inspection";
import {
  publicationSetupInputSchema,
  publicationSetupResultSchema,
} from "./publication-setup-contract";
import { secureOrigin } from "./security";
import { ownerBrowserCommand } from "./store";
export async function setupOwnedPublication(
  input: unknown,
  actor: { id: string; sessionId: string },
) {
  const value = publicationSetupInputSchema.parse(input),
    db = getDatabase();
  const before = await currentInspectionAccess(value, actor, db);
  const origin = await publicationInspectionRuntimeOrigin(value.nodeId, before, Sandbox);
  const ticket = await ownerBrowserCommand(
    { operation: "ticket", nodeId: value.nodeId, runId: value.runId },
    actor,
  );
  const current = await currentInspectionAccess(value, actor, db);
  if (
    current.origin !== before.origin ||
    !ticket.connection ||
    ticket.connection.origin !== origin ||
    ticket.connection.expiresAt <= Date.now()
  )
    throw new Error("setup_access_changed");
  const response = await fetch(`${origin}/publication-setup`, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Origin: secureOrigin(process.env.BROWSER_SANDBOX_PLATFORM_ORIGIN ?? ""),
    },
    body: JSON.stringify({
      ticket: ticket.connection.token,
      operation: value.operation,
      ...(value.operation === "activate" ? { candidateHash: value.candidateHash } : {}),
    }),
    signal: AbortSignal.timeout(55000),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("setup_unavailable");
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.length;
      if (size > 4096) throw new Error("setup_response_invalid");
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const result = publicationSetupResultSchema.parse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
  const after = await currentInspectionAccess(value, actor, db);
  if (
    after.origin !== before.origin ||
    Date.now() - Date.parse(result.observedAt) > 15000 ||
    Date.parse(result.observedAt) > Date.now() + 5000
  )
    throw new Error("setup_response_stale");
  return result;
}
