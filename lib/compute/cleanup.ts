/** Release billable compute before retrying metadata deletion. Never resume a VM. */
export async function cleanupComputeSandbox(
  sandbox: {
    delete(options: { deleteOrphanSnapshots: boolean; signal: AbortSignal }): Promise<void>;
  },
  session: { stop(options: { signal: AbortSignal }): Promise<unknown> },
) {
  const remove = () =>
    sandbox.delete({ deleteOrphanSnapshots: true, signal: AbortSignal.timeout(10_000) });
  const absent = (error: unknown) =>
    error instanceof Error &&
    "response" in error &&
    error.response instanceof Response &&
    error.response.status === 404;
  try {
    await remove();
    return;
  } catch (error) {
    if (absent(error)) return;
  }
  let stopped = false;
  try {
    await session.stop({ signal: AbortSignal.timeout(10_000) });
    stopped = true;
  } catch {
    // Deletion can still succeed even when the stop response was lost.
  }
  try {
    await remove();
    console.info("compute_cleanup.recovered", { stopped });
  } catch (error) {
    if (absent(error)) return;
    console.error("compute_cleanup.incomplete", { stopped, deadlineFallback: !stopped });
    if (!stopped) throw new Error("compute_cleanup_failed");
    // The nonpersistent VM is stopped: no further compute billing. Metadata
    // deletion failure must not invalidate a successfully rendered output.
  }
}
