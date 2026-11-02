import assert from "node:assert/strict";
import { cleanupComputeSandbox } from "../lib/compute/cleanup";

const logs: unknown[] = [];
const saved = { error: console.error, info: console.info };
console.error = (...args) => {
  logs.push(args);
};
console.info = (...args) => {
  logs.push(args);
};
try {
  for (const scenario of ["normal", "retry", "stopped", "failed", "absent"] as const) {
    const calls: string[] = [];
    let deletes = 0;
    const sandbox = {
      delete: async (options: { signal: AbortSignal; deleteOrphanSnapshots: boolean }) => {
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.deleteOrphanSnapshots, true);
        calls.push("delete");
        deletes++;
        if (scenario === "normal" || (scenario === "retry" && deletes === 2)) return;
        if (scenario === "absent")
          throw Object.assign(new Error("private"), {
            response: new Response(null, { status: 404 }),
          });
        throw new Error("private URL secret");
      },
    };
    const session = {
      stop: async () => {
        calls.push("stop");
        if (scenario === "failed") throw new Error("private");
      },
    };
    if (scenario === "failed")
      await assert.rejects(cleanupComputeSandbox(sandbox, session), /compute_cleanup_failed/);
    else await cleanupComputeSandbox(sandbox, session);
    assert.deepEqual(
      calls,
      ["normal", "absent"].includes(scenario) ? ["delete"] : ["delete", "stop", "delete"],
    );
  }
  assert.equal(JSON.stringify(logs).includes("private"), false);
} finally {
  Object.assign(console, saved);
}
console.log(
  "PASS cleanup: normal, transient delete, stop fallback, total failure, absent, privacy",
);
