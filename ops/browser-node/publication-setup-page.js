// Read-only discovery: never clicks, types, uploads, navigates or submits.
// biome-ignore lint/correctness/noUnusedVariables: Invoked as fixed source by the agent.
function discoverPublicationSetup(expected) {
  const fail = (stage) => ({ stage });
  if (location.origin !== "https://www.facebook.com") return fail("page");
  const visible = (e) =>
    !e.closest('[aria-hidden="true"], [inert]') &&
    e.getClientRects().length > 0 &&
    getComputedStyle(e).visibility !== "hidden";
  const all = (root, selector) => Array.from(root.querySelectorAll(selector)).filter(visible);
  const clean = (href) => {
    const u = new URL(href, location.href),
      keys = [];
    u.searchParams.forEach((_v, k) => {
      if (k === "__tn__" || /^__cft__\[\d+\]$/.test(k)) keys.push(k);
    });
    for (const k of keys) u.searchParams.delete(k);
    return u.href;
  };
  const matches = (href) => {
    const u = new URL(clean(href));
    return (
      u.origin === location.origin &&
      ((u.pathname === "/profile.php" && u.searchParams.get("id") === expected) ||
        u.pathname.replace(/\/$/, "") === `/${expected}`)
    );
  };
  const selectors = {
    identity: '[role="navigation"][aria-label="Shortcuts"] a',
    composer: '[role="dialog"]:has([role="textbox"])',
    textbox: '[role="textbox"][contenteditable="true"]',
    submit: '[role="button"][aria-label="Post"]',
    audience: '[aria-label^="Edit privacy."]',
    fileInput: 'input[type="file"]',
    attachmentName: "[data-ftrade-unreviewed-attachment]",
    post: '[aria-posinset]:has([data-ad-preview="message"])',
    postAuthor: "h2 a",
    postText: '[data-ad-preview="message"]',
    postLink:
      'div:has(> div > span > [data-ad-rendering-role="profile_name"]) > div:nth-child(2) a',
  };
  const composers = all(document, selectors.composer);
  if (composers.length === 1) {
    const composer = composers[0];
    const actors = all(composer, 'a[aria-label$="Timeline"]').filter((e) => matches(e.href));
    if (actors.length !== 1) return fail("identity");
    const actor = actors[0],
      actorSelector = `a[aria-label=${JSON.stringify(actor.getAttribute("aria-label"))}]`;
    if (all(composer, actorSelector).length !== 1) return fail("identity");
    const boxes = all(composer, selectors.textbox),
      audience = all(composer, selectors.audience);
    if (boxes.length !== 1 || all(composer, selectors.submit).length !== 1 || audience.length !== 1)
      return fail("composer");
    if (
      boxes[0].innerText.trim() ||
      all(composer, "video").length ||
      all(composer, 'img[src^="blob:"]').length
    )
      return fail("draft");
    const audienceText = audience[0].innerText.trim();
    if (!["Public", "Friends", "Only me"].includes(audienceText)) return fail("audience");
    return {
      stage: "composer",
      verified: true,
      identityHref: clean(actor.href),
      audienceText,
      selectors: { ...selectors, composerIdentity: actorSelector, receiptIdentity: actorSelector },
    };
  }
  if (composers.length) return fail("composer");
  const identity = all(document, selectors.identity).filter((e) => matches(e.href));
  const timeline = all(document, 'a[aria-label$="Timeline"]').filter((e) => matches(e.href));
  if (identity.length === 1 && location.pathname === "/") {
    const actor = identity[0];
    const buttons = all(document, '[role="button"]').filter((e) =>
      /^What's on your mind(?:, .+)?\?$/.test(e.innerText.trim()),
    );
    if (buttons.length !== 1) return fail("entry");
    return {
      stage: "entry",
      verified: true,
      identityHref: clean(actor.href),
      selectors: {
        identity: `${selectors.identity}[href=${JSON.stringify(actor.getAttribute("href"))}]`,
        openComposer: '[role="button"]',
      },
      openComposerText: buttons[0].innerText.trim(),
    };
  }
  if (timeline.length !== 1 || !matches(location.href)) return fail("identity");
  const posts = all(document, "[aria-posinset]");
  if (!posts.length) return fail("receipt");
  // A profile-photo update can prove author/timestamp structure even without a caption.
  // The executor still scans only captioned posts and requires an exact text/author/permalink receipt.
  const valid = posts.some((post) => {
    const authors = all(post, selectors.postAuthor),
      texts = all(post, selectors.postText),
      links = all(post, selectors.postLink);
    return (
      authors.length === 1 && matches(authors[0].href) && texts.length <= 1 && links.length === 1
    );
  });
  if (!valid) return fail("receipt");
  return {
    stage: "receipt",
    verified: true,
    identityHref: clean(timeline[0].href),
    selectors: {
      ...selectors,
      receiptIdentity: `a[aria-label=${JSON.stringify(timeline[0].getAttribute("aria-label"))}]`,
    },
  };
}
