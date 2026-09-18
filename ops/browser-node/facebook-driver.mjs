import pagePrograms from "./page-programs.cjs";

const pageProgram = pagePrograms.publication;

import { setTimeout as delay } from "node:timers/promises";

const selectors = [
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
];
export function validateFacebookProfile(value, now = Date.now()) {
  if (
    !value ||
    value.version !== 1 ||
    typeof value.accountRef !== "string" ||
    typeof value.channelRef !== "string" ||
    !value.accountRef.trim() ||
    value.accountRef.length > 160 ||
    !value.channelRef.trim() ||
    value.channelRef.length > 160 ||
    !/^evidence-[a-z0-9_-]{3,120}$/i.test(value.reviewRef ?? "")
  )
    throw new Error("facebook_profile_unreviewed");
  if (
    typeof value.audienceText !== "string" ||
    !value.audienceText.trim() ||
    value.audienceText.length > 100
  )
    throw new Error("facebook_profile_audience_missing");
  const reviewed = Date.parse(value.reviewedAt);
  const expires = Date.parse(value.expiresAt);
  if (
    !Number.isFinite(reviewed) ||
    reviewed > now ||
    !Number.isFinite(expires) ||
    expires <= now ||
    expires <= reviewed ||
    expires - reviewed > 30 * 86400000
  )
    throw new Error("facebook_profile_expired");
  for (const key of ["url", "identityHref"]) {
    const url = new URL(value[key]);
    if (
      url.origin !== "https://www.facebook.com" ||
      url.username ||
      url.password ||
      url.hash ||
      (key === "identityHref" && url.pathname === "/")
    )
      throw new Error("facebook_profile_origin_invalid");
  }
  if (
    selectors.some(
      (key) =>
        typeof value.selectors?.[key] !== "string" ||
        !value.selectors[key].trim() ||
        value.selectors[key].length > 500 ||
        value.selectors[key].includes(","),
    )
  )
    throw new Error("facebook_profile_selector_invalid");
  if (
    value.selectors.composerIdentity !== undefined &&
    (typeof value.selectors.composerIdentity !== "string" ||
      !value.selectors.composerIdentity.trim() ||
      value.selectors.composerIdentity.length > 500)
  )
    throw new Error("facebook_profile_selector_invalid");
  if (
    value.openComposerText !== undefined &&
    (typeof value.openComposerText !== "string" ||
      !value.openComposerText.trim() ||
      value.openComposerText.length > 200)
  )
    throw new Error("facebook_profile_selector_invalid");
  if (
    value.audienceSelection !== undefined &&
    ["dialog", "option", "defaultCheckbox", "confirm"].some(
      (key) =>
        typeof value.audienceSelection?.[key] !== "string" ||
        !value.audienceSelection[key].trim() ||
        value.audienceSelection[key].length > 500,
    )
  )
    throw new Error("facebook_profile_audience_selection_invalid");
  if (
    value.audienceSelection?.optionLabel !== undefined &&
    (typeof value.audienceSelection.optionLabel !== "string" ||
      !value.audienceSelection.optionLabel.trim() ||
      value.audienceSelection.optionLabel.length > 100)
  )
    throw new Error("facebook_profile_audience_selection_invalid");
  if (value.resolvePostLinks !== undefined && typeof value.resolvePostLinks !== "boolean")
    throw new Error("facebook_profile_selector_invalid");
  if (value.textOnly !== undefined && typeof value.textOnly !== "boolean")
    throw new Error("facebook_profile_format_invalid");
  if (value.receiptUrl !== undefined) {
    const receipt = new URL(value.receiptUrl);
    if (
      receipt.href !== value.identityHref ||
      typeof value.selectors.receiptIdentity !== "string" ||
      !value.selectors.receiptIdentity.trim() ||
      value.selectors.receiptIdentity.length > 500
    )
      throw new Error("facebook_profile_receipt_scope_invalid");
  }
  if (
    value.selectors.postHover !== undefined &&
    (typeof value.selectors.postHover !== "string" ||
      !value.selectors.postHover.trim() ||
      value.selectors.postHover.length > 500)
  )
    throw new Error("facebook_profile_selector_invalid");
  return structuredClone(value);
}

// This function runs in the page, with data-only arguments. No task-supplied JS.

async function json(response) {
  if (!response.ok || !response.body) throw new Error("facebook_browser_response_invalid");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128000) throw new Error("facebook_browser_response_limit");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function createFacebookDriver(input, browserRequest) {
  const profile = validateFacebookProfile(input);
  const evaluate = async (session, action) => {
    validateFacebookProfile(profile);
    if (session.signal.aborted) throw new Error("facebook_cancelled");
    const result = await json(
      await browserRequest(`/tabs/${encodeURIComponent(session.tabId)}/evaluate`, {
        userId: session.accountId,
        expression: `(${pageProgram})(${JSON.stringify(profile)},${JSON.stringify(action)})`,
      }),
    );
    if (!result.ok) throw new Error("facebook_evaluation_failed");
    return result.result;
  };
  const waitFor = async (session, kind) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await evaluate(session, { kind })) return;
      await delay(250, undefined, { signal: session.signal });
    }
    throw new Error("facebook_composer_transition_timeout");
  };
  const navigate = async (session, url) => {
    const response = await json(
      await browserRequest(`/tabs/${encodeURIComponent(session.tabId)}/navigate`, {
        userId: session.accountId,
        url,
      }),
    );
    if (!response.ok) throw new Error("facebook_navigation_invalid");
    await waitFor(session, "identity-ready");
    await evaluate(session, { kind: "identity" });
  };
  const readPosts = async (session) => {
    if (profile.receiptUrl && !session.readingReceipts) {
      await navigate(session, profile.receiptUrl);
      session.readingReceipts = true;
    }
    if (profile.resolvePostLinks) {
      const count = await evaluate(session, { kind: "post-count" });
      for (let index = 0; index < count; index++) {
        const response = await browserRequest("/act", {
          kind: "hover",
          targetId: session.tabId,
          userId: session.accountId,
          selector: `${profile.selectors.post} >> nth=${index} >> ${profile.selectors.postHover ?? profile.selectors.postLink}`,
        });
        // Facebook can replace the timestamp during hover. A read-only hover
        // may then time out after resolving the href; the page validation below
        // must still prove a real permalink. Never retry a publication click.
        if (response.status === 422) {
          const failure = await response.clone().json();
          if (failure.code !== "element_not_actionable")
            throw new Error("facebook_permalink_hover_failed");
        } else if (!(await json(response)).ok) {
          throw new Error("facebook_permalink_hover_failed");
        }
      }
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      const posts = await evaluate(session, { kind: "posts" });
      if (posts.every((post) => post.externalPublicationRef !== null)) return posts;
      await delay(250, undefined, { signal: session.signal });
    }
    throw new Error("facebook_permalink_unresolved");
  };
  return {
    async open(run, signal) {
      if (profile.textOnly && run.publication?.format !== "text")
        throw new Error("facebook_profile_format_unreviewed");
      if (
        run.accountRef !== profile.accountRef ||
        run.channelRef !== profile.channelRef ||
        !run.accountId ||
        !run.id
      )
        throw new Error("facebook_profile_scope_invalid");
      const tab = await json(
        await browserRequest("/tabs", {
          userId: run.accountId,
          sessionKey: run.id,
          url: profile.url,
          trace: false,
        }),
      );
      if (typeof tab.tabId !== "string" || tab.tabId.length > 200 || tab.url !== profile.url)
        throw new Error("facebook_navigation_invalid");
      return {
        tabId: tab.tabId,
        accountId: run.accountId,
        signal,
        baseline: new Set(),
        expected: null,
      };
    },
    async identity(session) {
      await waitFor(session, "identity-ready");
      return evaluate(session, { kind: "identity" });
    },
    async existingPublicationRefs(session) {
      const posts = await readPosts(session);
      session.baseline = new Set(posts.map((post) => post.externalPublicationRef));
      return [...session.baseline];
    },
    async prepare(session, payload, upload) {
      if (session.readingReceipts) {
        await navigate(session, profile.url);
        session.readingReceipts = false;
      }
      await evaluate(session, { kind: "open" });
      await waitFor(session, "composer-ready");
      if (profile.audienceSelection && (await evaluate(session, { kind: "audience-open" }))) {
        await waitFor(session, "audience-picker-ready");
        await evaluate(session, { kind: "audience-select" });
        await waitFor(session, "audience-selection-ready");
        await evaluate(session, { kind: "audience-confirm" });
        await waitFor(session, "audience-applied");
      }
      await evaluate(session, { kind: "inspect" });
      if (upload) {
        await evaluate(session, { kind: "upload-check" });
        const attached = await json(
          await browserRequest(`/tabs/${encodeURIComponent(session.tabId)}/upload`, {
            userId: session.accountId,
            path: upload.path,
          }),
        );
        if (!attached.ok || attached.attached?.length !== 1 || attached.attached[0] !== upload.path)
          throw new Error("facebook_upload_failed");
      }
      // Upload may replace the composer and discard its earlier text. Recheck
      // the active composer after attaching, then type into that composer only.
      await evaluate(session, { kind: "inspect" });
      const active =
        ':not([aria-hidden="true"]):not([aria-hidden="true"] *):not([inert]):not([inert] *)';
      const selector = `${profile.selectors.composer}${active} ${profile.selectors.textbox}${active}`;
      // React contenteditable fields can duplicate fill(text). Clear first,
      // then use real keyboard events; the final preview still must match.
      for (const [mode, text] of [
        ["fill", ""],
        ["keyboard", payload.text],
      ]) {
        await json(
          await browserRequest(`/tabs/${encodeURIComponent(session.tabId)}/type`, {
            userId: session.accountId,
            selector,
            text,
            mode,
            submit: false,
            pressEnter: false,
          }),
        );
      }
      session.expected = {
        kind: "publish",
        text: payload.text,
        attachmentCount: upload ? 1 : 0,
        attachmentName: upload?.path.split("/").at(-1),
      };
    },
    inspect: (session) => evaluate(session, { kind: "inspect" }),
    async publish(session, authorization) {
      if (!session.expected || session.clicked)
        throw new Error("facebook_publish_already_attempted");
      session.clicked = true;
      await evaluate(session, {
        ...session.expected,
        localExpiresAt: authorization.localExpiresAt,
      });
    },
    async observe(session, payload, signal) {
      if (profile.receiptUrl) await waitFor(session, "composer-closed");
      for (let attempt = 0; attempt < 20; attempt++) {
        const posts = await readPosts(session);
        const matches = posts.filter(
          (post) =>
            post.accountRef === profile.accountRef &&
            post.text === payload.text &&
            !session.baseline.has(post.externalPublicationRef),
        );
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) throw new Error("facebook_post_ambiguous");
        await delay(500, undefined, { signal });
      }
      throw new Error("facebook_post_not_observed");
    },
    async close() {
      /* The lease owner stops the whole isolated runtime. */
    },
  };
}
