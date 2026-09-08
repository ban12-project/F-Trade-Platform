// Trusted page program, read as source so host transpilers cannot inject helper dependencies.
// biome-ignore lint/correctness/noUnusedVariables: The driver reads and invokes this fixed page source.
function inspectPage(profile, action) {
  if (Date.now() >= Date.parse(profile.expiresAt)) throw new Error("facebook_profile_expired");
  if (location.origin !== "https://www.facebook.com") throw new Error("facebook_origin_changed");
  const visible = (element) =>
    !!element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
  const all = (root, selector, requireVisible = true) =>
    [...root.querySelectorAll(selector)].filter((element) => !requireVisible || visible(element));
  const one = (root, selector, requireVisible = true) => {
    const items = all(root, selector, requireVisible);
    if (items.length !== 1) throw new Error("facebook_control_ambiguous");
    return items[0];
  };
  const enabled = (element) =>
    !element.disabled && element.getAttribute("aria-disabled") !== "true";
  const identity = one(document, profile.selectors.identity);
  if (identity.href !== profile.identityHref) throw new Error("facebook_identity_changed");
  if (action.kind === "identity")
    return { accountRef: profile.accountRef, channelRef: profile.channelRef };
  if (action.kind === "posts") {
    const posts = all(document, profile.selectors.post);
    if (posts.length > 100) throw new Error("facebook_post_scan_limit");
    return posts.map((post) => {
      const author = one(post, profile.selectors.postAuthor);
      const link = one(post, profile.selectors.postLink);
      return {
        accountRef: author.href === profile.identityHref ? profile.accountRef : null,
        channelRef: profile.channelRef,
        text: one(post, profile.selectors.postText).innerText,
        externalPublicationRef: link.href,
      };
    });
  }
  if (action.kind === "open") {
    if (!all(document, profile.selectors.composer).length) {
      const button = one(document, profile.selectors.openComposer);
      if (!enabled(button)) throw new Error("facebook_composer_disabled");
      button.click();
    }
    return true;
  }
  const composer = one(document, profile.selectors.composer);
  const textbox = one(composer, profile.selectors.textbox);
  const submit = one(composer, profile.selectors.submit);
  const attachments = all(composer, profile.selectors.attachmentName);
  const text = "value" in textbox ? textbox.value : textbox.innerText;
  const preview = {
    accountRef: profile.accountRef,
    channelRef: profile.channelRef,
    text,
    attachmentCount: attachments.length,
    attachmentName: attachments[0]?.innerText,
    readyToPublish: enabled(submit),
  };
  if (action.kind === "upload-check") {
    // Pinned Camofox uploads to the first file input globally. Require that this
    // is the one and only input and belongs to the verified composer.
    const input = one(composer, profile.selectors.fileInput, false);
    if (
      input.tagName !== "INPUT" ||
      input.type !== "file" ||
      document.querySelectorAll('input[type="file"]').length !== 1
    )
      throw new Error("facebook_file_input_ambiguous");
  }
  if (action.kind === "publish") {
    if (!Number.isFinite(action.localExpiresAt) || Date.now() >= action.localExpiresAt)
      throw new Error("facebook_authorization_expired");
    if (
      text !== action.text ||
      !preview.readyToPublish ||
      preview.attachmentCount !== action.attachmentCount ||
      (action.attachmentCount === 1 && preview.attachmentName !== action.attachmentName)
    )
      throw new Error("facebook_preview_changed");
    // One DOM click, no generic click endpoint with retry/fallback behavior.
    submit.click();
  }
  return preview;
}
