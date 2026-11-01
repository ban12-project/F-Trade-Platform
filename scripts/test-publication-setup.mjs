import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPublicationSetup } from "../ops/browser-node/publication-setup.mjs";

const identityHref = "https://www.facebook.com/profile.php?id=10000123456789";
const selectors = Object.fromEntries(
  [
    "identity",
    "openComposer",
    "composer",
    "textbox",
    "submit",
    "audience",
    "fileInput",
    "attachmentName",
    "post",
    "postAuthor",
    "postText",
    "postLink",
    "composerIdentity",
    "receiptIdentity",
  ].map((k) => [k, `#${k}`]),
);
const entry = {
  stage: "entry",
  verified: true,
  identityHref,
  selectors: { identity: selectors.identity, openComposer: selectors.openComposer },
  openComposerText: "What's on your mind, Synthetic?",
};
const composer = {
  stage: "composer",
  verified: true,
  identityHref,
  audienceText: "Only me",
  selectors,
};
const receipt = { stage: "receipt", verified: true, identityHref, selectors };
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "synthetic-publication-setup-"));
  const run = {
    id: "synthetic-run",
    kind: "interactive",
    channelRef: "facebook-synthetic",
    accountRef: "synthetic-fixed-ref",
    accountId: "synthetic-account",
  };
  await writeFile(
    join(dir, "login.json"),
    JSON.stringify([
      {
        channelRef: run.channelRef,
        accountRef: run.accountRef,
        profile: { automation: { accountRef: "10000123456789" } },
      },
    ]),
    { mode: 0o600 },
  );
  let observation = entry,
    active = true,
    rejectActivation = false,
    automatic = false,
    activationCount = 0;
  const options = {
    stateDir: dir,
    managedDirectory: dir,
    assertActive() {
      if (!active) throw Error("revoked");
    },
    browserRequest: async (_slot, path, body) => {
      if (automatic) {
        assert(!("text" in body) && !("files" in body));
        if (path.endsWith("/navigate")) {
          observation = body.url === "https://www.facebook.com/" ? entry : receipt;
          return Response.json({ ok: true });
        }
        if (body.expression.includes(".click(")) {
          assert(body.expression.includes("buttons[0].click()"));
          observation = composer;
          return Response.json({ ok: true, result: true });
        }
      }
      assert(path.endsWith("/evaluate"));
      assert(!body.expression.includes(".click("));
      return Response.json({ ok: true, result: observation });
    },
    activate: async () => {
      if (rejectActivation) throw Error("queued-publication");
      activationCount++;
    },
  };
  const setup = createPublicationSetup(options);
  await setup.initialize();
  const slot = { run, interactiveTabId: "synthetic-tab" };
  try {
    await fn({
      setup,
      slot,
      dir,
      options,
      setObservation(v) {
        observation = v;
      },
      setActive(v) {
        active = v;
      },
      setAutomatic() {
        automatic = true;
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
test("three read-only checks bind one account, explicit activation persists and loads without enabling account controls", () =>
  fixture(async (f) => {
    assert.deepEqual(f.setup.scopes(), []);
    let result = await f.setup.handle(f.slot, { operation: "inspect" });
    assert.equal(result.entry, true);
    assert.equal(result.candidateHash, null);
    f.setObservation(receipt);
    await f.setup.handle(f.slot, { operation: "inspect" });
    f.setObservation(composer);
    result = await f.setup.handle(f.slot, { operation: "inspect" });
    assert(result.candidateHash);
    assert.equal(f.count(), 0);
    assert.deepEqual(f.setup.scopes(), []);
    result = await f.setup.handle(f.slot, {
      operation: "activate",
      candidateHash: result.candidateHash,
    });
    assert.equal(result.active, true);
    assert.equal(f.count(), 1);
    await f.setup.handle(f.slot, { operation: "activate", candidateHash: result.candidateHash });
    assert.equal(f.count(), 1);
    assert.equal(f.setup.scopes()[0].textOnly, true);
    const values = JSON.parse(
      await readFile(join(f.dir, "publication-setup/reviewed.json"), "utf8"),
    );
    assert.equal(values[0].accountRef, f.slot.run.accountRef);
    assert.equal(values[0].textOnly, true);
    const reloaded = createPublicationSetup(f.options);
    await reloaded.initialize();
    assert.deepEqual(reloaded.scopes(), f.setup.scopes());
  }));
test("partial, forged, stale, different account, changed audience and revoked page cannot activate", () =>
  fixture(async (f) => {
    await assert.rejects(
      f.setup.handle(f.slot, { operation: "activate", candidateHash: "a".repeat(64) }),
    );
    await f.setup.handle(f.slot, { operation: "inspect" });
    f.setObservation(receipt);
    await f.setup.handle(f.slot, { operation: "inspect" });
    f.setObservation(composer);
    const result = await f.setup.handle(f.slot, { operation: "inspect" });
    await assert.rejects(
      f.setup.handle(f.slot, { operation: "activate", candidateHash: "a".repeat(64) }),
    );
    await assert.rejects(
      f.setup.handle(
        { ...f.slot, run: { ...f.slot.run, id: "other-run", accountRef: "other-account" } },
        { operation: "activate", candidateHash: result.candidateHash },
      ),
    );
    f.setObservation({ ...composer, audienceText: "Public" });
    await assert.rejects(
      f.setup.handle(f.slot, { operation: "activate", candidateHash: result.candidateHash }),
    );
    f.setObservation({ stage: "draft" });
    await assert.rejects(
      f.setup.handle(f.slot, { operation: "activate", candidateHash: result.candidateHash }),
    );
    f.setActive(false);
    await assert.rejects(
      f.setup.handle(f.slot, { operation: "activate", candidateHash: result.candidateHash }),
    );
    assert.equal(f.count(), 0);
    assert.deepEqual(f.setup.scopes(), []);
  }));
test("activation failure does not persist authority", () =>
  fixture(async (f) => {
    await f.setup.handle(f.slot, { operation: "inspect" });
    f.setObservation(receipt);
    await f.setup.handle(f.slot, { operation: "inspect" });
    f.setObservation(composer);
    const result = await f.setup.handle(f.slot, { operation: "inspect" });
    f.rejectActivation();
    await assert.rejects(
      f.setup.handle(f.slot, { operation: "activate", candidateHash: result.candidateHash }),
    );
    await assert.rejects(readFile(join(f.dir, "publication-setup/reviewed.json")));
    // A new service must not pick up a mere draft or unactivated candidate.
    const second = createPublicationSetup(f.options);
    await second.initialize();
    assert.deepEqual(second.scopes(), []);
    assert.equal(result.active, false);
  }));

test("automatic review navigates only account pages and opens an empty editor, never activates or publishes", () =>
  fixture(async (f) => {
    f.setAutomatic();
    const result = await f.setup.handle(f.slot, { operation: "prepare" });
    assert.equal(result.entry, true);
    assert.equal(result.receipt, true);
    assert.equal(result.composer, true);
    assert(result.candidateHash);
    assert.equal(result.active, false);
    assert.equal(f.count(), 0);
    assert.deepEqual(f.setup.scopes(), []);
  }));
