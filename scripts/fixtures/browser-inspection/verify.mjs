import assert from "node:assert/strict";
import {
  createPublicationPageInspector,
  PublicationInspectionFailure,
} from "/fixture/publication-inspection.mjs";
import { profile } from "./data.mjs";

const userId = "synthetic-image-smoke";
const headers = {
  "content-type": "application/json",
  authorization: "Bearer SYNTHETIC-image-smoke-key",
};
const api = async (path, body, method = "POST") => {
  const response = await fetch(`http://127.0.0.1:9377${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  return response;
};
const { tabId } = await (
  await api("/tabs", {
    userId,
    sessionKey: "synthetic-dom",
    trace: false,
    url: "https://www.facebook.com/?synthetic-inspection=empty",
  })
).json();
assert.ok(tabId);
const inspector = createPublicationPageInspector({
  directory: "SYNTHETIC-unused",
  assertActive() {},
  candidate: async () => ({
    profile,
    candidateHash: "a".repeat(64),
    candidateExpiresAt: "2000-01-01T00:00:00Z",
  }),
  browserRequest: async (_slot, path, body) => {
    assert.equal(path, `/tabs/${encodeURIComponent(tabId)}/evaluate`);
    assert.equal(body.userId, userId);
    return api(path, body);
  },
});
const slot = { run: { kind: "interactive", accountId: userId }, interactiveTabId: tabId };
for (const kind of ["empty", "nonempty", "friends", "ambiguous", "wrong-identity", "page-error"]) {
  await api(`/tabs/${encodeURIComponent(tabId)}/navigate`, {
    userId,
    url: `https://www.facebook.com/?synthetic-inspection=${kind}`,
  });
  if (kind === "page-error") {
    await assert.rejects(inspector(slot), (error) => {
      assert(error instanceof PublicationInspectionFailure);
      assert.equal(error.stage, "page");
      assert.equal(error.message, "inspection_unavailable");
      return true;
    });
    continue;
  }
  const observed = await inspector(slot);
  assert.equal(observed.candidateExpired, true);
  assert.equal(observed.videoPreviewCount, 0);
  assert.equal(observed.videoReceiptVisible, null);
  assert.equal(observed.identityMatched, kind !== "wrong-identity");
  if (kind === "wrong-identity" || kind === "ambiguous") {
    assert.equal(observed.controls.composer, kind === "ambiguous" ? 2 : 0);
    assert.equal(observed.composerEmpty, null);
    assert.equal(observed.audienceMatchesCandidate, null);
    assert.equal(observed.composerIdentityMatched, null);
  } else {
    assert.equal(observed.controls.composer, 1);
    assert.equal(observed.controls.openComposer, 1);
    assert.equal(observed.controls.textbox, 1);
    assert.equal(observed.controls.fileInput, 1);
    assert.equal(observed.composerIdentityMatched, true);
    assert.equal(observed.composerEmpty, kind !== "nonempty");
    assert.equal(observed.audienceMatchesCandidate, kind !== "friends");
  }
  assert(!JSON.stringify(observed).includes("SYNTHETIC unsent text"));
}
await api(`/tabs/${encodeURIComponent(tabId)}`, { userId }, "DELETE");
console.log(
  "PASS: native Firefox HTTP full-DOM inspection and negative controls, no external traffic",
);
