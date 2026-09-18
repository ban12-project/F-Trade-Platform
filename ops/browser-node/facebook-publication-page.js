// Trusted page program, read as source so host transpilers cannot inject helper dependencies.
// biome-ignore lint/correctness/noUnusedVariables: The driver reads and invokes this fixed page source.
function inspectPage(profile, action) {
  if (Date.now() >= Date.parse(profile.expiresAt)) throw new Error("facebook_profile_expired");
  if (location.origin !== "https://www.facebook.com") throw new Error("facebook_origin_changed");
  const visible = (element) =>
    !element.closest('[aria-hidden="true"], [inert]') &&
    !!element.getClientRects().length &&
    getComputedStyle(element).visibility !== "hidden";
  const all = (root, selector, requireVisible = true) =>
    [...root.querySelectorAll(selector)].filter((element) => !requireVisible || visible(element));
  const one = (root, selector, requireVisible = true) => {
    const items = all(root, selector, requireVisible);
    if (items.length !== 1) throw new Error("facebook_control_ambiguous");
    return items[0];
  };
  const enabled = (element) =>
    !element.disabled && element.getAttribute("aria-disabled") !== "true";
  // Facebook adds this navigation-only query to the composer author link.
  // Preserve every other path/query component, especially profile.php?id.
  const identityHref = (href) => {
    const url = new URL(href);
    url.searchParams.delete("__tn__");
    return url.href;
  };
  if (action.kind.startsWith("audience-") && action.kind !== "audience-open") {
    const selection = profile.audienceSelection;
    if (!selection) throw new Error("facebook_audience_selection_unconfigured");
    const dialogs = all(document, selection.dialog);
    if (action.kind === "audience-picker-ready" && !dialogs.length) return false;
    const dialog = one(document, selection.dialog);
    const option = one(dialog, selection.option);
    const defaultCheckbox = one(dialog, selection.defaultCheckbox);
    const checked = (element) =>
      element.checked === true || element.getAttribute("aria-checked") === "true";
    if (action.kind === "audience-picker-ready") return true;
    if (action.kind === "audience-select") {
      if (!enabled(option)) throw new Error("facebook_audience_disabled");
      if (!checked(option)) option.click();
      return true;
    }
    const selected = checked(option) && !checked(defaultCheckbox);
    if (action.kind === "audience-selection-ready") return selected;
    if (action.kind !== "audience-confirm" || !selected)
      throw new Error("facebook_audience_selection_changed");
    const confirm = one(dialog, selection.confirm);
    if (!enabled(confirm)) throw new Error("facebook_audience_disabled");
    confirm.click();
    return true;
  }
  const composers = all(document, profile.selectors.composer);
  if (action.kind === "composer-ready") {
    if (!composers.length) return false;
    one(document, profile.selectors.composer);
    return true;
  }
  const identity =
    profile.selectors.composerIdentity && composers.length
      ? one(one(document, profile.selectors.composer), profile.selectors.composerIdentity)
      : one(document, profile.selectors.identity);
  if (identityHref(identity.href) !== identityHref(profile.identityHref))
    throw new Error("facebook_identity_changed");
  if (action.kind === "identity")
    return { accountRef: profile.accountRef, channelRef: profile.channelRef };
  if (action.kind === "posts") {
    const posts = all(document, profile.selectors.post);
    if (posts.length > 100) throw new Error("facebook_post_scan_limit");
    return posts.map((post) => {
      const author = one(post, profile.selectors.postAuthor);
      const link = one(post, profile.selectors.postLink);
      return {
        accountRef:
          identityHref(author.href) === identityHref(profile.identityHref)
            ? profile.accountRef
            : null,
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
  const audience = one(composer, profile.selectors.audience);
  if (action.kind === "audience-open") {
    if (audience.innerText.trim() === profile.audienceText) return false;
    if (!enabled(audience)) throw new Error("facebook_audience_disabled");
    audience.click();
    return true;
  }
  if (audience.innerText.trim() !== profile.audienceText)
    throw new Error("facebook_audience_changed");
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
