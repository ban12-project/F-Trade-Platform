/** Permanent after the VPS cutover. Environment flags cannot restore billing.
 * Read-only inspection and explicit deletion remain available for cleanup.
 */
export function rejectRetiredSandboxExecution(): never {
  throw new Error("vercel_sandbox_retired_use_vps");
}
