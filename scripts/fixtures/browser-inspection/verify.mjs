import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
for (const kind of [
  "empty",
  "nonempty",
  "friends",
  "ambiguous",
  "wrong-identity",
  "page-error",
  "tracked",
  "query-mismatch",
  "tracking-lookalike",
  "inert-background",
  "foreign-composer",
  "missing-composer-actor",
]) {
  console.log({ syntheticCase: kind });
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
  let observed;
  try {
    observed = await inspector(slot);
  } catch (error) {
    // This container only contains the synthetic fixture and has no network.
    // Exception details are test diagnostics, never a production response.
    const program = readFileSync("/fixture/publication-inspection-page.js", "utf8");
    const diagnosed = await api(`/tabs/${encodeURIComponent(tabId)}/evaluate`, {
      userId,
      expression: `(() => { try { return (${program})(${JSON.stringify(profile)}); } catch (error) { return { name: String(error?.name), message: String(error?.message).slice(0, 500), stack: String(error?.stack).slice(0, 1500) }; } })()`,
    });
    console.log({ syntheticException: await diagnosed.json() });
    throw error;
  }
  assert.equal(observed.candidateExpired, true);
  assert.equal(observed.videoPreviewCount, 0);
  assert.equal(observed.videoReceiptVisible, null);
  const wrongIdentity = [
    "wrong-identity",
    "query-mismatch",
    "tracking-lookalike",
    "ambiguous",
    "foreign-composer",
    "missing-composer-actor",
  ].includes(kind);
  assert.equal(observed.identityMatched, !wrongIdentity);
  if (wrongIdentity || kind === "ambiguous") {
    assert.equal(observed.controls.composer, 0);
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
// The exact same broad selector and optional label used by the publication
// program must report missing/unique/ambiguous controls without exposing text.
profile.openComposerText = "Open";
for (const [kind, expected] of [
  ["open-filtered", 1],
  ["open-missing", 0],
  ["open-duplicate", 2],
]) {
  await api(`/tabs/${encodeURIComponent(tabId)}/navigate`, {
    userId,
    url: `https://www.facebook.com/?synthetic-inspection=${kind}`,
  });
  const observed = await inspector(slot);
  assert.equal(observed.controls.openComposer, expected);
  assert(!JSON.stringify(observed).includes("Open"));
}
// Exercise the actual publisher page program, including a real DOM side effect.
// The fixture is synthetic and physically has no outbound network.
const publication = readFileSync("/fixture/facebook-publication-page.js", "utf8");
const publisherProfile = { ...profile, expiresAt: new Date(Date.now() + 60000).toISOString() };
await api(`/tabs/${encodeURIComponent(tabId)}/navigate`, {
  userId,
  url: "https://www.facebook.com/?synthetic-inspection=closed",
});
const publicationAction = async (kind, extra = {}) => {
  const response = await api(`/tabs/${encodeURIComponent(tabId)}/evaluate`, {
    userId,
    expression: `(async () => { try { return { result: await (${publication})(${JSON.stringify(publisherProfile)},${JSON.stringify({ kind, ...extra })}) }; } catch (error) { return { syntheticError: String(error?.message).slice(0,500) }; } })()`,
  });
  const body = await response.json();
  assert.equal(body.result.syntheticError, undefined, JSON.stringify(body));
  return body.result.result;
};
assert.equal(await publicationAction("composer-closed"), true);
assert.equal(await publicationAction("open"), true);
assert.equal(await publicationAction("composer-ready"), true);
assert.equal((await inspector(slot)).controls.composer, 1);
// Caption attribution uses the same post boundary for body, author, media and link.
Object.assign(publisherProfile.selectors, {
  post: "article",
  postAuthor: ".author",
  postText: ".copy",
  postLink: ".permalink",
});
publisherProfile.accountRef = "synthetic-account";
publisherProfile.channelRef = "synthetic-channel";
publisherProfile.videoReceipt = { mode: "captioned_post" };
await api(`/tabs/${encodeURIComponent(tabId)}/navigate`, {
  userId,
  url: "https://www.facebook.com/?synthetic-inspection=captioned-receipt",
});
const captionedPosts = await publicationAction("posts", {
  text: "SYNTHETIC approved caption",
  captionedVideo: true,
});
assert.equal(captionedPosts.length, 3);
assert.deepEqual(
  captionedPosts.map((post) => post.videoCount),
  [1, 1, 2],
);
assert.equal(captionedPosts[0].accountRef, publisherProfile.accountRef);
assert.equal(captionedPosts[1].accountRef, null);
assert.equal(captionedPosts[0].externalPublicationRef, "https://www.facebook.com/reel/1001");
assert.equal(Object.hasOwn((await publicationAction("posts"))[0], "videoCount"), false);
// The reviewed return path uses the same native HTTP scroll contract in both
// directions. Lazy-feed behavior and publication attribution are exercised by
// the driver DOM regression; these calls prove native transport compatibility.
for (const [direction, amount] of [
  ["down", 850],
  ["up", 450],
]) {
  const scrolled = await api(`/tabs/${encodeURIComponent(tabId)}/scroll`, {
    userId,
    direction,
    amount,
  });
  assert.equal((await scrolled.json()).ok, true);
}
await api(`/tabs/${encodeURIComponent(tabId)}`, { userId }, "DELETE");
console.log(
  "PASS: native Firefox HTTP full-DOM inspection and negative controls, no external traffic",
);
