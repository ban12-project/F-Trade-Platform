// Synthetic DOM only. No account, profile, cookies or external media are used.
export const identityHref = "https://www.facebook.com/profile.php?id=100000000000001";
export const profile = {
  identityHref,
  audienceText: "Only me",
  selectors: {
    identity: '[role="navigation"][aria-label="Shortcuts"] a',
    composerIdentity: 'a[aria-label="SYNTHETIC Timeline"]',
    openComposer: '[role="button"][data-synthetic-open]',
    composer: '[role="dialog"]:has([role="textbox"])',
    textbox: '[role="textbox"][contenteditable="true"]',
    submit: '[role="button"][aria-label="Post"]',
    audience: '[aria-label^="Edit privacy."]',
    fileInput: 'input[type="file"]',
    attachmentName: "[data-synthetic-attachment]",
  },
};
export function syntheticPage(kind) {
  const href =
    kind === "wrong-identity"
      ? "https://www.facebook.com/SYNTHETIC-other"
      : kind === "tracked"
        ? `${identityHref}&__tn__=SYNTHETIC&__cft__%5B0%5D=one&__cft__%5B0%5D=two&__cft__%5B2%5D=three`
        : kind === "query-mismatch"
          ? `${identityHref}&SYNTHETIC-unreviewed=1`
          : kind === "tracking-lookalike"
            ? `${identityHref}&__cft__%5Bnon-numeric%5D=SYNTHETIC`
            : identityHref;
  const textbox =
    kind === "page-error"
      ? '<svg width="100" height="100"><g role="textbox" contenteditable="true"><rect width="90" height="90"/></g></svg>'
      : `<div role="textbox" contenteditable="true">${kind === "nonempty" ? "SYNTHETIC unsent text" : ""}</div>`;
  const composer = `<div role="dialog"><a aria-label="SYNTHETIC Timeline" href="${href}">SYNTHETIC actor</a>${textbox}<div role="button" aria-label="Post">Post</div><button aria-label="Edit privacy. audience">${kind === "friends" ? "Friends" : "Only me"}</button><input type="file" hidden></div>`;
  return `<!doctype html><title>SYNTHETIC inspection fixture</title><nav role="navigation" aria-label="Shortcuts"><a href="${href}">SYNTHETIC identity</a></nav><div role="button" data-synthetic-open>Open</div>${composer}${kind === "ambiguous" ? composer : ""}`;
}
