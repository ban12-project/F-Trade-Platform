import assert from "node:assert/strict";
import { test } from "node:test";
import { withPublicationSetup } from "../ops/browser-node/publication-adapter.mjs";

const scope = {
  channelRef: "facebook",
  accountRef: "stable-account",
  expiresAt: 200,
  textOnly: false,
};
for (const format of ["text", "image", "video"])
  test(`existing ${format} executor survives setup and restart`, async () => {
    const base = { capabilities: ["publish"], publicationScopes: [scope], execute: () => "base" };
    const setup = { scopes: () => [{ ...scope, textOnly: true }], execute: () => "setup" };
    const adapter = withPublicationSetup(base, setup, () => 100);
    assert.equal(adapter.publicationScopes[0].textOnly, false);
    assert.equal(
      await adapter.execute({ run: { ...scope, kind: "publish", publication: { format } } }),
      "base",
    );
    base.publicationScopes = [{ ...scope, expiresAt: 99 }];
    assert.equal(adapter.publicationScopes[0].textOnly, true);
    assert.equal(await adapter.execute({ run: { ...scope, kind: "publish" } }), "setup");
    assert.equal(
      await adapter.execute({ run: { ...scope, accountRef: "other", kind: "publish" } }),
      "failed",
    );
  });

import { upgradeGeneratedPublicationProfile } from "../ops/browser-node/publication-profile-compat.mjs";

test("compatibility upgrades only generated placeholder profile without renewing scope or rebinding identity", () => {
  const old = {
    textOnly: true,
    url: "https://www.facebook.com/",
    identityHref: "https://www.facebook.com/10000123456789",
    receiptUrl: "https://www.facebook.com/10000123456789",
    expiresAt: "2026-01-01",
    resolvePostLinks: true,
    selectors: {
      attachmentName: "[data-ftrade-unreviewed-attachment]",
      composer: '[role="dialog"]:has([role="textbox"])',
      textbox: '[role="textbox"][contenteditable="true"]',
      fileInput: 'input[type="file"]',
      composerIdentity: "#actor",
      receiptIdentity: "#actor",
    },
  };
  const upgraded = upgradeGeneratedPublicationProfile(old);
  assert.equal(upgraded.textOnly, false);
  assert.equal(upgraded.imagePreview, "blob-sha256");
  assert.equal(upgraded.videoReceipt.mode, "captioned_post");
  assert.equal(upgraded.expiresAt, old.expiresAt);
  assert.equal(upgraded.identityHref, old.identityHref);
  assert.equal(old.textOnly, true);
  const privateProfile = {
    ...old,
    selectors: { ...old.selectors, attachmentName: ".reviewed-name" },
  };
  assert.deepEqual(upgradeGeneratedPublicationProfile(privateProfile), privateProfile);
});
