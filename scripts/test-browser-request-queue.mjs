import assert from "node:assert/strict";
import test from "node:test";
import { scheduleBrowserRequest } from "../ops/browser-node/request-queue.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function slot() {
  return { abort: new AbortController(), expiresAt: Date.now() + 30000 };
}

test("a blocked account does not block another account", async () => {
  const a = slot(),
    b = slot(),
    gate = deferred();
  const pending = scheduleBrowserRequest(a, () => gate.promise, a.abort.signal);
  assert.equal(await scheduleBrowserRequest(b, () => 42, b.abort.signal), 42);
  gate.resolve();
  await pending;
});

test("queued work rechecks the lease and cannot run after expiry", async () => {
  const s = slot(),
    gate = deferred();
  const first = scheduleBrowserRequest(s, () => gate.promise, s.abort.signal);
  await Promise.resolve();
  let calls = 0;
  const second = scheduleBrowserRequest(s, () => ++calls, s.abort.signal);
  const results = Promise.allSettled([first, second]);
  s.expiresAt = 0;
  gate.resolve();
  assert.deepEqual(
    (await results).map((x) => x.status),
    ["rejected", "rejected"],
  );
  assert.equal(calls, 0);
});

test("an aborted waiter rejects promptly and never sends a delayed request", async () => {
  const s = slot(),
    gate = deferred(),
    deadline = new AbortController();
  const first = scheduleBrowserRequest(s, () => gate.promise, s.abort.signal);
  await Promise.resolve();
  let calls = 0;
  const second = scheduleBrowserRequest(s, () => ++calls, deadline.signal);
  const denied = assert.rejects(second, /deadline/);
  deadline.abort(new Error("deadline"));
  await denied;
  gate.resolve();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});

test("failure rejects pending requests without retries", async () => {
  const s = slot(),
    gate = deferred();
  const first = scheduleBrowserRequest(s, () => gate.promise, s.abort.signal);
  await Promise.resolve();
  let calls = 0;
  const second = scheduleBrowserRequest(s, () => ++calls, s.abort.signal);
  const results = Promise.allSettled([first, second]);
  gate.reject(new Error("operation_unknown"));
  assert.ok(
    (await results).every(
      (x) => x.status === "rejected" && x.reason.message === "operation_unknown",
    ),
  );
  assert.equal(calls, 0);
});

test("observer timeout retains ownership until work settles and rejects its queued successor", async () => {
  const s = slot(),
    gate = deferred(),
    deadline = new AbortController();
  const first = scheduleBrowserRequest(s, () => gate.promise, deadline.signal);
  await Promise.resolve();
  let calls = 0;
  const second = scheduleBrowserRequest(s, () => ++calls, s.abort.signal);
  const denied = assert.rejects(first, /deadline/);
  const successor = assert.rejects(second, /deadline/);
  deadline.abort(new Error("deadline"));
  await denied;
  assert.equal(calls, 0);
  gate.resolve();
  await successor;
  assert.equal(calls, 0);
});

test("request backlog is bounded without sending excess work", async () => {
  const s = slot(),
    gate = deferred();
  const pending = Array.from({ length: 8 }, () =>
    scheduleBrowserRequest(s, () => gate.promise, s.abort.signal),
  );
  await assert.rejects(
    scheduleBrowserRequest(s, () => assert.fail("overflow sent"), s.abort.signal),
    /queue_full/,
  );
  gate.resolve();
  await Promise.all(pending);
});
