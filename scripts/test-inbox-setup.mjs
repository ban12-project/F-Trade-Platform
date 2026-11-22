import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { nodeRequestSchema } from "../lib/browser-fleet/contracts.ts";
import { createFacebookLiveInboxAgent } from "../ops/browser-node/facebook-inbox-agent.mjs";
import { createInboxSetup } from "../ops/browser-node/inbox-setup.mjs";

const verifiedObservation = {
  stage: "inbox",
  verified: true,
  threadCount: 2,
  emptyInbox: false,
};

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "synthetic-inbox-setup-"));
  const run = {
    id: "synthetic-inbox-run",
    kind: "interactive",
    channelRef: "facebook-personal",
    accountRef: "61589008383902",
    accountId: "synthetic-account",
  };
  await writeFile(
    join(dir, "login.json"),
    JSON.stringify([
      {
        channelRef: run.channelRef,
        accountRef: run.accountRef,
        profile: { automation: { accountRef: "61589008383902" } },
      },
    ]),
    { mode: 0o600 },
  );

  let observation = verifiedObservation;
  let active = true;
  let rejectActivation = false;
  let activationCount = 0;
  const navigations = [];

  const options = {
    stateDir: dir,
    managedDirectory: dir,
    assertActive() {
      if (!active) throw Error("revoked");
    },
    async browserRequest(_slot, path, body) {
      assert(!("text" in (body ?? {})) && !("files" in (body ?? {})));
      if (path.endsWith("/navigate")) {
        navigations.push(body.url);
        return Response.json({ ok: true });
      }
      assert(path.endsWith("/evaluate"));
      assert(!body.expression.includes(".click("));
      return Response.json({ ok: true, result: observation });
    },
    async activate() {
      if (rejectActivation) throw Error("queued-inbox-run");
      activationCount++;
    },
  };

  const setup = createInboxSetup(options);
  await setup.initialize();
  const slot = { run, interactiveTabId: "synthetic-tab" };

  try {
    await fn({
      setup,
      slot,
      dir,
      options,
      navigations,
      setObservation(value) {
        observation = value;
      },
      setActive(value) {
        active = value;
      },
      rejectActivation() {
        rejectActivation = true;
      },
      count: () => activationCount,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("prepare and activate persists reviewed inbox profile, survives reload and is idempotent per run", () =>
  fixture(async (f) => {
    assert.deepEqual(f.setup.scopes(), []);
    const prepared = await f.setup.handle(f.slot, { operation: "prepare" });
    assert.deepEqual(f.navigations, ["https://www.facebook.com/messages/"]);
    assert.equal(prepared.stage, "reviewed");
    assert.equal(prepared.inboxVerified, true);
    assert.equal(prepared.threadCount, 2);
    assert.equal(prepared.active, false);
    assert(prepared.candidateHash);
    assert.equal(f.count(), 0);
    assert.deepEqual(f.setup.scopes(), []);

    const activated = await f.setup.handle(f.slot, {
      operation: "activate",
      candidateHash: prepared.candidateHash,
    });
    assert.equal(activated.stage, "ready");
    assert.equal(activated.active, true);
    assert.equal(f.count(), 1);

    await f.setup.handle(f.slot, {
      operation: "activate",
      candidateHash: prepared.candidateHash,
    });
    assert.equal(f.count(), 1);
    assert.equal(f.setup.scopes().length, 1);

    const saved = JSON.parse(await readFile(join(f.dir, "inbox-setup/reviewed.json"), "utf8"));
    assert.equal(saved[0].version, 2);
    assert.equal(saved[0].mode, "facebook-live-agent");
    assert.equal(saved[0].expectedAccountRef, "61589008383902");

    const reloaded = createInboxSetup(f.options);
    await reloaded.initialize();
    assert.deepEqual(reloaded.scopes(), f.setup.scopes());
  }));

test("stale, mismatched, changed-identity, attention, or inactive leases cannot activate", () =>
  fixture(async (f) => {
    await assert.rejects(
      f.setup.handle(f.slot, { operation: "activate", candidateHash: "a".repeat(64) }),
    );
    const prepared = await f.setup.handle(f.slot, { operation: "prepare" });
    await assert.rejects(
      f.setup.handle(f.slot, { operation: "activate", candidateHash: "b".repeat(64) }),
    );
    await assert.rejects(
      f.setup.handle(
        { ...f.slot, run: { ...f.slot.run, id: "other-run", accountRef: "other-account" } },
        { operation: "activate", candidateHash: prepared.candidateHash },
      ),
    );
    f.setObservation({ stage: "identity", verified: false, threadCount: 0, emptyInbox: false });
    await assert.rejects(
      f.setup.handle(f.slot, { operation: "activate", candidateHash: prepared.candidateHash }),
    );
    f.setObservation({ stage: "attention", verified: false, threadCount: 0, emptyInbox: false });
    await assert.rejects(
      f.setup.handle(f.slot, { operation: "activate", candidateHash: prepared.candidateHash }),
    );
    f.setObservation(verifiedObservation);
    f.setActive(false);
    await assert.rejects(
      f.setup.handle(f.slot, { operation: "activate", candidateHash: prepared.candidateHash }),
    );
    assert.equal(f.count(), 0);
    assert.deepEqual(f.setup.scopes(), []);
  }));

test("platform activation failure leaves reviewed.json unwritten and scopes empty", () =>
  fixture(async (f) => {
    const prepared = await f.setup.handle(f.slot, { operation: "prepare" });
    f.rejectActivation();
    await assert.rejects(
      f.setup.handle(f.slot, { operation: "activate", candidateHash: prepared.candidateHash }),
    );
    await assert.rejects(readFile(join(f.dir, "inbox-setup/reviewed.json")));
    const reloaded = createInboxSetup(f.options);
    await reloaded.initialize();
    assert.deepEqual(reloaded.scopes(), []);
  }));

test("live inbox agent classifies failure enums without leaking raw errors and nodeRequestSchema validates inboxFailure", async () => {
  const baseProfile = {
    version: 2,
    mode: "facebook-live-agent",
    channelRef: "facebook-personal",
    accountRef: "61589008383902",
    expectedAccountRef: "61589008383902",
    reviewRef: "evidence-test-123",
    reviewedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    url: "https://www.facebook.com/messages/",
  };
  const baseRun = {
    kind: "inbox",
    id: "00000000-0000-4000-8000-000000000001",
    accountId: "00000000-0000-4000-8000-000000000002",
    channelRef: "facebook-personal",
    accountRef: "61589008383902",
  };
  const makeBrowserRequest = () => async (path) => {
    if (path === "/tabs") return Response.json({ ok: true, tabId: "tab-1", url: baseProfile.url });
    if (path.endsWith("/evaluate")) {
      return Response.json({
        ok: true,
        result: {
          mode: "list",
          empty: false,
          threads: [
            {
              conversationRef: "1618185166252064",
              url: "https://www.facebook.com/messages/e2ee/t/1618185166252064/",
            },
          ],
        },
      });
    }
    if (path.includes("/snapshot"))
      return Response.json({ ok: true, snapshot: '- grid "Chats"\n  - link "Thread"' });
    return Response.json({ ok: true });
  };

  const cases = [
    {
      name: "unverified finish",
      decide: async () => ({ command: { action: "finish", target: "", valueRef: "" } }),
      expected: "inbox_agent_unverified_finish",
    },
    {
      name: "invalid action",
      decide: async () => ({ command: { action: "click", target: "thread-0", valueRef: "" } }),
      expected: "inbox_agent_invalid_action",
    },
    {
      name: "raw non-allowlisted error",
      decide: async () => {
        throw new Error("raw sensitive DOM body should never leak");
      },
      expected: "inbox_unclassified",
    },
  ];

  for (const item of cases) {
    const failures = [];
    const execute = createFacebookLiveInboxAgent(baseProfile, makeBrowserRequest(), item.decide);
    const outcome = await execute({
      run: baseRun,
      signal: new AbortController().signal,
      reportInbound: async () => ({ accepted: 0, duplicates: 0 }),
      onInboxFailure: (code) => failures.push(code),
    });
    assert.equal(outcome, "failed", item.name);
    assert.deepEqual(failures, [item.expected], item.name);
  }

  const valid = nodeRequestSchema.safeParse({
    operation: "finish",
    installationId: "00000000-0000-4000-8000-000000000010",
    bootId: "00000000-0000-4000-8000-000000000011",
    runId: baseRun.id,
    leaseId: "00000000-0000-4000-8000-000000000012",
    stopped: true,
    outcome: "failed",
    inboxFailure: "inbox_agent_invalid_action",
  });
  assert.equal(valid.success, true);

  const invalid = nodeRequestSchema.safeParse({
    operation: "finish",
    installationId: "00000000-0000-4000-8000-000000000010",
    bootId: "00000000-0000-4000-8000-000000000011",
    runId: baseRun.id,
    leaseId: "00000000-0000-4000-8000-000000000012",
    stopped: true,
    outcome: "failed",
    inboxFailure: "raw message: leak!",
  });
  assert.equal(invalid.success, false);
});
