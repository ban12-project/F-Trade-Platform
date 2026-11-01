import "server-only";
import type { DatabaseTransaction } from "../db/client";

/** Permanent retirement: never read credentials or authorize another VM, even
 * if a stale deployment configuration still sets BROWSER_SANDBOX_ENABLED=1.
 * Keep the signature for pending workflow callers; inspection/stop is separate.
 */
export async function authorizeManualSandboxStart(
  _tx: DatabaseTransaction,
  _nodeId: string,
  _operationId: string,
  _now = Date.now(),
): Promise<{ sandboxName: string; accessKey: string } | null> {
  return null;
}

export const authorizeBrowserSandboxStart = authorizeManualSandboxStart;
