import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createGateway } from "../ops/browser-node/gateway.mjs";
import {
  createPublicationPageInspector,
  PublicationInspectionFailure,
  publicationInspectionFailureStage,
  readPublicationInspectionCandidate,
} from "../ops/browser-node/publication-inspection.mjs";

const run = {
  id: randomUUID(),
  kind: "interactive",
  accountId: randomUUID(),
  accountRef: "SYNTHETIC-account",
  channelRef: "synthetic-facebook",
};
const controls = Object.fromEntries(
  [
    "identity",
    "openComposer",
    "composer",
    "textbox",
    "submit",
    "audience",
    "fileInput",
    "attachmentName",
  ].map((k) => [k, 1]),
);
const sample = {
  identityMatched: true,
  controls,
  composerIdentityMatched: true,
  composerEmpty: true,
  audienceMatchesCandidate: true,
  videoPreviewCount: 0,
  videoReceiptVisible: null,
};
const candidate = {
  profile: {},
  candidateHash: "a".repeat(64),
  candidateExpiresAt: "2000-01-01T00:00:00Z",
  candidateExpired: true,
};
const slot = {
  run,
  ready: true,
  stopping: false,
  expiresAt: Date.now() + 30000,
  interactiveTabId: "synthetic-live-tab",
};
test("private expired candidates remain byte-identical and cannot confer publication capability", async () => {
  const dir = await mkdtemp(join(tmpdir(), "synthetic-page-review-"));
  try {
    await chmod(dir, 0o700);
    const value = {
      version: 1,
      accountRef: run.accountRef,
      channelRef: run.channelRef,
      identityHref: "https://www.facebook.com/synthetic-own-profile",
      audienceText: "Only me",
      openComposerText: "SYNTHETIC exact composer label",
      expiresAt: "2000-01-01T00:00:00Z",
      selectors: Object.fromEntries(Object.keys(controls).map((k) => [k, `#${k}`])),
    };
    const text = JSON.stringify([value]),
      file = join(dir, "publication.json");
    await writeFile(file, text, { mode: 0o600 });
    const stat = await lstat(file);
    const observed = await readPublicationInspectionCandidate(dir, run);
    assert.equal(observed.candidateExpired, true);
    assert.equal(observed.profile.openComposerText, value.openComposerText);
    assert.equal(await readFile(file, "utf8"), text);
    assert.equal((await lstat(file)).mtimeMs, stat.mtimeMs);
    assert(!("capabilities" in observed));
    for (const invalid of [null, 7, [], "", " ", "x".repeat(201)]) {
      await writeFile(file, JSON.stringify([{ ...value, openComposerText: invalid }]));
      await assert.rejects(readPublicationInspectionCandidate(dir, run));
    }
    await writeFile(file, text);
    await assert.rejects(
      readPublicationInspectionCandidate(dir, { ...run, accountRef: "other-account" }),
    );
    await chmod(file, 0o644);
    await assert.rejects(readPublicationInspectionCandidate(dir, run));
    await chmod(file, 0o600);
    await writeFile(file, JSON.stringify([value, value]));
    await assert.rejects(readPublicationInspectionCandidate(dir, run));
    await rm(file);
    await symlink(join(dir, "missing"), file);
    await assert.rejects(readPublicationInspectionCandidate(dir, run));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("fixed failure stages discard private errors and preserve late lease failures", async () => {
  for (const stage of ["active", "tab", "candidate", "browser", "response"]) {
    const inspect = createPublicationPageInspector({
      directory: "synthetic",
      assertActive() {
        if (stage === "active") throw Error("SYNTHETIC private lease detail");
      },
      candidate: async () => {
        if (stage === "candidate") throw Error("SYNTHETIC private candidate");
        return candidate;
      },
      browserRequest: async () => {
        if (stage === "browser") throw Error("SYNTHETIC private transport");
        return stage === "response"
          ? Response.json({ ok: true, result: { privateCaption: "SYNTHETIC private body" } })
          : Response.json({ ok: true, result: sample });
      },
    });
    await assert.rejects(
      inspect(stage === "tab" ? { ...slot, interactiveTabId: null } : slot),
      (error) => {
        assert(error instanceof PublicationInspectionFailure);
        assert.equal(error.stage, stage);
        assert.equal(error.message, "inspection_unavailable");
        assert(!String(error).includes("SYNTHETIC private"));
        return true;
      },
    );
  }
  let checks = 0;
  const late = createPublicationPageInspector({
    directory: "synthetic",
    candidate: async () => candidate,
    assertActive() {
      if (++checks === 3) throw Error("SYNTHETIC late revoke");
    },
    browserRequest: async () => Response.json({ ok: true, result: sample }),
  });
  await assert.rejects(
    late(slot),
    (error) => error instanceof PublicationInspectionFailure && error.stage === "active",
  );
});
test("fixed page envelope classifies source and selector errors without returning page exception text", async () => {
  for (const failure of ["tab", "candidate", "page", "null"]) {
    const stage = failure === "null" ? "page" : failure;
    let queries = 0;
    const inspect = createPublicationPageInspector({
      directory: "synthetic",
      assertActive() {},
      candidate: async () => ({
        ...candidate,
        profile: {
          identityHref: "https://www.facebook.com/synthetic-profile",
          selectors: { identity: "#synthetic-identity" },
        },
      }),
      browserRequest: async (_slot, _path, body) => {
        const result = runInNewContext(
          body.expression,
          {
            URL,
            location:
              stage === "tab"
                ? { origin: "null", pathname: "blank" }
                : { origin: "https://www.facebook.com", pathname: "/" },
            document: {
              querySelectorAll() {
                queries++;
                if (failure === "null") throw null;
                const error = Error("SYNTHETIC private selector and caption");
                if (stage === "candidate") error.name = "SyntaxError";
                throw error;
              },
            },
          },
          { timeout: 1000 },
        );
        assert.equal(result.inspectionFailure, stage);
        assert(!JSON.stringify(result).includes("SYNTHETIC private"));
        return Response.json({ ok: true, result });
      },
    });
    await assert.rejects(
      inspect(slot),
      (error) => error instanceof PublicationInspectionFailure && error.stage === stage,
    );
    assert.equal(queries, stage === "tab" ? 0 : 1);
  }
  const inspect = createPublicationPageInspector({
    directory: "synthetic",
    assertActive() {},
    candidate: async () => candidate,
    browserRequest: async () =>
      Response.json({
        ok: true,
        result: { inspectionFailure: "tab", privateCaption: "SYNTHETIC private" },
      }),
  });
  await assert.rejects(
    inspect(slot),
    (error) => error instanceof PublicationInspectionFailure && error.stage === "response",
  );
});
test("gateway failure stages require valid one-use admission and a still-live task", async () => {
  const tickets = new Set(["candidate", "page", "forged", "late"]);
  const active = { ...slot, run: { ...run }, expiresAt: Date.now() + 30000 };
  const slots = new Map([[run.id, active]]);
  let fault = "candidate",
    release;
  const gateway = createGateway({
    appOrigin: "https://synthetic-app.example",
    slots,
    port: 0,
    inspectionFailureStage: publicationInspectionFailureStage,
    async nodeCall(_op, { ticket }) {
      if (!tickets.delete(ticket)) throw Error("SYNTHETIC invalid ticket");
      return { runId: run.id };
    },
    async inspectPublicationPage() {
      if (fault === "late")
        await new Promise((resolve) => {
          release = resolve;
        });
      if (fault === "forged")
        throw Object.assign(Error("SYNTHETIC private error"), { stage: "candidate" });
      throw new PublicationInspectionFailure(fault === "page" ? "page" : "candidate");
    },
  });
  await new Promise((resolve) => gateway.server.once("listening", resolve));
  const url = `http://127.0.0.1:${gateway.server.address().port}/publication-inspection`;
  const post = (ticket, origin = "https://synthetic-app.example") =>
    fetch(url, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
  try {
    const unauthorized = await post("candidate", "https://other.example");
    assert.equal(unauthorized.status, 403);
    assert.equal(await unauthorized.text(), "");
    const response = await post("candidate");
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      version: 1,
      kind: "publication_inspection_failure",
      stage: "candidate",
    });
    const replay = await post("candidate");
    assert.equal(replay.status, 403);
    assert.equal(await replay.text(), "");
    fault = "page";
    const pageFailure = await post("page");
    assert.equal(pageFailure.status, 422);
    assert.deepEqual(await pageFailure.json(), {
      version: 1,
      kind: "publication_inspection_failure",
      stage: "page",
    });
    fault = "forged";
    const forged = await post("forged");
    assert.equal(forged.status, 403);
    assert.equal(await forged.text(), "");
    fault = "late";
    const pending = post("late");
    while (!release) await new Promise((resolve) => setTimeout(resolve, 10));
    active.stopping = true;
    release();
    const stopped = await pending;
    assert.equal(stopped.status, 403);
    assert.equal(await stopped.text(), "");
  } finally {
    gateway.close();
  }
});
test("fixed inspection reads only the bound task tab and projects bounded fields", async () => {
  let calls = 0;
  const inspect = createPublicationPageInspector({
    directory: "synthetic",
    candidate: async () => candidate,
    assertActive(s) {
      assert.equal(s, slot);
    },
    async browserRequest(s, path, body) {
      calls++;
      assert.equal(s, slot);
      assert.equal(path, "/tabs/synthetic-live-tab/evaluate");
      assert.equal(body.userId, run.accountId);
      assert(!body.expression.includes(".click("));
      return Response.json({
        ok: true,
        result: { ...sample, PRIVATE_CAPTION: "SYNTHETIC private body", candidateHash: "secret" },
      });
    },
  });
  const result = await inspect(slot);
  assert.equal(calls, 1);
  assert.equal(result.candidateHash, candidate.candidateHash);
  assert(!JSON.stringify(result).includes("SYNTHETIC private body"));
  assert.equal(result.candidateExpired, true);
  await assert.rejects(inspect({ ...slot, interactiveTabId: undefined }));
});
test("expiry after response and malformed/oversized observations do not return results", async () => {
  for (const fault of ["expired", "bad_count", "oversized"]) {
    let active = true;
    const inspect = createPublicationPageInspector({
      directory: "synthetic",
      candidate: async () => candidate,
      assertActive() {
        if (!active) throw Error("lease_expired");
      },
      async browserRequest() {
        if (fault === "expired") active = false;
        return fault === "oversized"
          ? new Response("x".repeat(8193))
          : Response.json({
              ok: true,
              result:
                fault === "bad_count"
                  ? { ...sample, controls: { ...controls, fileInput: 99 } }
                  : sample,
            });
      },
    });
    await assert.rejects(inspect(slot));
  }
});
test("gateway admission is one-use, same-origin, interactive and rechecked after inspection", async () => {
  let tickets = new Set(["allowed", "late"]),
    calls = 0,
    delayResolve;
  const active = { ...slot, run: { ...run }, expiresAt: Date.now() + 30000 };
  const slots = new Map([[run.id, active]]);
  const gateway = createGateway({
    appOrigin: "https://synthetic-app.example",
    slots,
    port: 0,
    async nodeCall(op, { ticket }) {
      assert.equal(op, "admit");
      if (!tickets.delete(ticket)) throw Error("replay");
      return { runId: run.id };
    },
    async inspectPublicationPage(s) {
      calls++;
      assert.equal(s, active);
      if (calls === 2)
        await new Promise((resolve) => {
          delayResolve = resolve;
        });
      return { version: 1 };
    },
  });
  await new Promise((resolve) => gateway.server.once("listening", resolve));
  const url = `http://127.0.0.1:${gateway.server.address().port}/publication-inspection`;
  const post = (ticket, origin = "https://synthetic-app.example", extra = {}) =>
    fetch(url, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, ...extra }),
    });
  try {
    assert.equal((await post("allowed", "https://other.example")).status, 403);
    assert.equal(calls, 0);
    assert.equal((await post("allowed", undefined, { expression: "private script" })).status, 403);
    assert.equal(calls, 0);
    assert.equal((await post("allowed")).status, 200);
    assert.equal(calls, 1);
    assert.equal((await post("allowed")).status, 403);
    assert.equal(calls, 1);
    const pending = post("late");
    while (!delayResolve) await new Promise((resolve) => setTimeout(resolve, 10));
    active.stopping = true;
    delayResolve();
    assert.equal((await pending).status, 403);
  } finally {
    gateway.close();
  }
});
