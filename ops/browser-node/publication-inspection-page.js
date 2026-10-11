// Read-only, fixed page program. No click, navigation, typing, upload, network fetch or persistence.
// biome-ignore lint/correctness/noUnusedVariables: Loaded by the managed inspection service as fixed source.
function inspectPublicationCandidate(profile) {
  if (
    location.origin !== "https://www.facebook.com" ||
    ![
      "/",
      "/me",
      new URL(profile.identityHref).pathname.replace(/\/$/, "") || "/",
      "/reels/create",
      "/reel/create",
    ].includes(location.pathname.replace(/\/$/, "") || "/")
  )
    throw new Error("inspection_page_unavailable");
  const visible = (e) =>
    !e.closest('[aria-hidden="true"], [inert]') &&
    !!e.getClientRects().length &&
    getComputedStyle(e).visibility !== "hidden";
  const all = (root, key) =>
    Array.from(root.querySelectorAll(profile.selectors[key])).filter(
      (e) => key === "fileInput" || visible(e),
    );
  const normalized = (href) => {
    const u = new URL(href, location.href);
    u.searchParams.delete("__tn__");
    // Camoufox's isolated scope does not expose the iterator symbol of
    // URLSearchParams.keys(). Collect before deleting so duplicates are safe.
    const tracking = [];
    u.searchParams.forEach((_value, key) => {
      if (/^__cft__\[\d+\]$/.test(key)) tracking.push(key);
    });
    for (const key of tracking) u.searchParams.delete(key);
    return u.href;
  };
  // Facebook hides the background navigation while a composer is open.
  // Match the active composer actor, as the publication program does; never
  // fall back to the background identity for an ambiguous or foreign actor.
  const composers = all(document, "composer");
  const identities = composers.length
    ? composers.length === 1 && profile.selectors.composerIdentity
      ? all(composers[0], "composerIdentity")
      : []
    : all(document, "identity");
  const identityMatched =
    identities.length === 1 && normalized(identities[0].href) === normalized(profile.identityHref);
  const controls = {
    identity: Math.min(25, identities.length),
    openComposer: 0,
    composer: Math.min(25, composers.length),
    textbox: 0,
    submit: 0,
    audience: 0,
    fileInput: 0,
    attachmentName: 0,
  };
  const result = {
    identityMatched,
    controls,
    composerIdentityMatched: null,
    composerEmpty: null,
    audienceMatchesCandidate: null,
    videoPreviewCount: 0,
    videoReceiptVisible: null,
  };
  if (!identityMatched) return result;
  controls.openComposer = Math.min(
    25,
    all(document, "openComposer").filter(
      (element) =>
        !profile.openComposerText || element.innerText.trim() === profile.openComposerText,
    ).length,
  );
  if (composers.length !== 1) return result;
  const composer = composers[0];
  for (const key of ["textbox", "submit", "audience", "fileInput", "attachmentName"])
    controls[key] = Math.min(25, all(composer, key).length);
  const actor = profile.selectors.composerIdentity
    ? Array.from(composer.querySelectorAll(profile.selectors.composerIdentity)).filter(visible)
    : [];
  result.composerIdentityMatched =
    actor.length === 1 && normalized(actor[0].href) === normalized(profile.identityHref);
  const boxes = all(composer, "textbox");
  if (boxes.length === 1) result.composerEmpty = boxes[0].innerText.trim() === "";
  const audience = all(composer, "audience");
  if (audience.length === 1)
    result.audienceMatchesCandidate = audience[0].innerText.trim() === profile.audienceText;
  result.videoPreviewCount = Math.min(
    25,
    Array.from(composer.querySelectorAll("video")).filter(
      (e) => visible(e) && e.getAttribute("src")?.startsWith("blob:"),
    ).length,
  );
  if (profile.videoReceipt) {
    const notices = Array.from(document.querySelectorAll(profile.videoReceipt.container)).filter(
      visible,
    );
    result.videoReceiptVisible =
      notices.length === 1 && notices[0].innerText.trim() === profile.videoReceipt.successText;
  }
  return result;
}
