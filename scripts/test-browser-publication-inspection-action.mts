import assert from "node:assert/strict";
import { mock } from "node:test";

let current: { user: { id: string; role: string }; session: { id: string } } | null = null,
  calls: { input: unknown; actor: unknown }[] = [],
  failure = false;
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module(new URL("../lib/browser-fleet/sandbox-workflow-delivery.ts", import.meta.url).href, {
  exports: {
    deliverQueuedBrowserSandboxes: async () => {
      throw new Error("Inspection must not dispatch workflows");
    },
  },
});
mock.module(new URL("../lib/auth.ts", import.meta.url).href, {
  exports: { auth: { api: { getSession: async () => current } } },
});
mock.module(new URL("../lib/browser-fleet/publication-page-inspection.ts", import.meta.url).href, {
  exports: {
    inspectOwnedPublicationPage: async (input: unknown, actor: unknown) => {
      calls.push({ input, actor });
      if (failure) throw Error("SYNTHETIC_PRIVATE_PAGE_DETAILS");
      return { version: 1 };
    },
  },
});
const { inspectPublicationPageAction } = await import("../lib/actions/browser-nodes");
const input = {
  nodeId: "00000000-0000-4000-8000-000000000991",
  runId: "00000000-0000-4000-8000-000000000992",
};
assert.equal((await inspectPublicationPageAction(input)).ok, false);
assert.equal(calls.length, 0);
current = { user: { id: "SYNTHETIC actor", role: "user" }, session: { id: "SYNTHETIC session" } };
assert.equal((await inspectPublicationPageAction(input)).ok, false);
assert.equal(calls.length, 0);
current.user.role = "admin";
assert.equal((await inspectPublicationPageAction({ ...input, actorId: "forged" })).ok, false);
assert.equal(calls.length, 0);
assert.equal((await inspectPublicationPageAction(input)).ok, true);
assert.deepEqual(calls[0], {
  input,
  actor: { id: "SYNTHETIC actor", sessionId: "SYNTHETIC session" },
});
failure = true;
const result = await inspectPublicationPageAction(input);
assert.equal(result.ok, false);
assert(!JSON.stringify(result).includes("SYNTHETIC_PRIVATE_PAGE_DETAILS"));
console.log(
  "PASS action authentication, strict input, trusted identity and private-error suppression",
);
