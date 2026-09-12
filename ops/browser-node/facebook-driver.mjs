import pagePrograms from "./page-programs.cjs";

const pageProgram = pagePrograms.publication;

import { setTimeout as delay } from "node:timers/promises";

const selectors = [
  "identity",
  "openComposer",
  "composer",
  "textbox",
  "submit",
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
  return {
    async open(run, signal) {
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
    identity: (session) => evaluate(session, { kind: "identity" }),
    async existingPublicationRefs(session) {
      const posts = await evaluate(session, { kind: "posts" });
      session.baseline = new Set(posts.map((post) => post.externalPublicationRef));
      return [...session.baseline];
    },
    async prepare(session, payload, upload) {
      await evaluate(session, { kind: "open" });
      await evaluate(session, { kind: "inspect" });
      await json(
        await browserRequest(`/tabs/${encodeURIComponent(session.tabId)}/type`, {
          userId: session.accountId,
          selector: `${profile.selectors.composer} ${profile.selectors.textbox}`,
          text: payload.text,
          mode: "fill",
          submit: false,
          pressEnter: false,
        }),
      );
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
      for (let attempt = 0; attempt < 20; attempt++) {
        const posts = await evaluate(session, { kind: "posts" });
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
