import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createFacebookDriver, validateFacebookProfile } from "./facebook-driver.mjs";
import { createPublicationExecutor } from "./publication-executor.mjs";
import { upgradeGeneratedPublicationProfile } from "./publication-profile-compat.mjs";

const program = await readFile(new URL("./publication-setup-page.js", import.meta.url), "utf8");
const key = (run) => JSON.stringify([run.channelRef, run.accountRef]);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function privateJson(path) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await fd.stat();
    if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600 || s.size > 64000)
      throw new Error("setup_file_invalid");
    const source = await fd.readFile("utf8");
    if (Buffer.byteLength(source) > 64000) throw new Error("setup_file_invalid");
    return JSON.parse(source);
  } finally {
    await fd.close();
  }
}
export function createPublicationSetup({
  stateDir,
  managedDirectory,
  browserRequest,
  assertActive,
  activate,
}) {
  const directory = join(stateDir, "publication-setup"),
    profiles = new Map(),
    drafts = new Map();
  let writing = false;
  const running = new Set();
  const activated = new Map();
  const scopes = () =>
    [...profiles.values()]
      .filter((p) => Date.parse(p.expiresAt) > Date.now())
      .map((p) => ({
        channelRef: p.channelRef,
        accountRef: p.accountRef,
        expiresAt: Date.parse(p.expiresAt),
        textOnly: p.textOnly === true,
        audience: "Public",
      }));
  async function initialize() {
    await mkdir(directory, { mode: 0o700, recursive: true });
    const s = await lstat(directory);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      s.uid !== process.getuid() ||
      (s.mode & 0o777) !== 0o700
    )
      throw new Error("setup_directory_invalid");
    let values;
    try {
      values = await privateJson(join(directory, "reviewed.json"));
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    if (!Array.isArray(values) || values.length > 16) throw new Error("setup_profiles_invalid");
    for (const previous of values) {
      const p = upgradeGeneratedPublicationProfile(previous);
      const expires = Date.parse(p.expiresAt);
      validateFacebookProfile(p, expires <= Date.now() ? expires - 1 : Date.now());
      if (profiles.has(key(p))) throw new Error("setup_profiles_duplicate");
      profiles.set(key(p), p);
    }
  }
  async function observe(slot) {
    assertActive(slot);
    if (slot.run.kind !== "interactive" || !slot.interactiveTabId)
      throw new Error("setup_run_invalid");
    const configured = await privateJson(join(managedDirectory, "login.json"));
    const matches = configured.filter((p) => key(p) === key(slot.run));
    // The reviewed binding supplies only the expected Facebook identity, never a renewed login authorization.
    const expected = matches.length === 1 ? matches[0].profile?.automation?.accountRef : null;
    if (!/^[0-9]{5,30}$/.test(expected ?? "")) throw new Error("setup_identity_unconfigured");
    const response = await browserRequest(
      slot,
      `/tabs/${encodeURIComponent(slot.interactiveTabId)}/evaluate`,
      {
        userId: slot.run.accountId,
        expression: `(() => { try { return (${program})(${JSON.stringify(expected)}); } catch { return {stage:"page"}; } })()`,
      },
      5000,
    );
    if (!response.ok || !response.body) throw new Error("setup_page_unavailable");
    const reader = response.body.getReader(),
      parts = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 8192) throw new Error("setup_response_invalid");
        parts.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
    assertActive(slot);
    if (
      body.ok !== true ||
      !body.result ||
      !["entry", "composer", "receipt", "identity", "draft", "audience", "page"].includes(
        body.result.stage,
      )
    )
      throw new Error("setup_response_invalid");
    return body.result;
  }
  function summary(draft, stage, active = false) {
    const complete = ["entry", "composer", "receipt"].every((k) => draft?.[k]);
    return {
      version: 1,
      stage,
      entry: !!draft?.entry,
      composer: !!draft?.composer,
      receipt: !!draft?.receipt,
      audience: draft?.composer?.audienceText ?? null,
      candidateHash: complete ? hash(draft) : null,
      active,
      observedAt: new Date().toISOString(),
      textOnly: true,
    };
  }
  async function perform(slot, input) {
    const now = Date.now();
    assertActive(slot);
    if (input.operation === "activate" && activated.get(slot.run.id)?.hash === input.candidateHash)
      return { ...activated.get(slot.run.id).result, observedAt: new Date().toISOString() };
    for (const [id, d] of drafts) if (d.deadline <= now) drafts.delete(id);
    if (!["inspect", "prepare", "activate"].includes(input.operation))
      throw new Error("setup_operation_invalid");
    if (input.operation === "prepare") {
      // Safe navigation and opening an EMPTY editor only. No content, uploads,
      // privacy changes or submit controls are ever passed to this operation.
      let current = await observe(slot);
      if (current.stage !== "entry" || current.verified !== true)
        return summary(drafts.get(slot.run.id), current.stage);
      const draft = { deadline: now + 10 * 60_000, entry: current };
      drafts.set(slot.run.id, draft);
      const navigate = async (url) => {
        assertActive(slot);
        const response = await browserRequest(
          slot,
          `/tabs/${encodeURIComponent(slot.interactiveTabId)}/navigate`,
          { userId: slot.run.accountId, url },
          10000,
        );
        await response.body?.cancel();
        if (!response.ok) throw new Error("setup_navigation_failed");
      };
      const wait = async (stage) => {
        let value;
        for (let attempt = 0; attempt < 12; attempt++) {
          value = await observe(slot);
          if (value.stage === stage && value.verified === true) return value;
          await delay(300);
        }
        return value;
      };
      await navigate(current.identityHref);
      current = await wait("receipt");
      if (current.stage !== "receipt" || !current.verified) {
        const response = await browserRequest(
          slot,
          `/tabs/${encodeURIComponent(slot.interactiveTabId)}/scroll`,
          { userId: slot.run.accountId, direction: "down", amount: 900 },
          5000,
        );
        await response.body?.cancel();
        current = await wait("receipt");
      }
      if (current.stage !== "receipt" || !current.verified) return summary(draft, "receipt");
      draft.receipt = current;
      await navigate("https://www.facebook.com/");
      current = await wait("entry");
      if (
        current.stage !== "entry" ||
        !current.verified ||
        current.identityHref !== draft.entry.identityHref
      )
        return summary(draft, "identity");
      const response = await browserRequest(
        slot,
        `/tabs/${encodeURIComponent(slot.interactiveTabId)}/evaluate`,
        {
          userId: slot.run.accountId,
          expression: `(() => { const p=${JSON.stringify(current)}; const visible=e=>!e.closest('[aria-hidden="true"], [inert]')&&e.getClientRects().length>0; if(location.origin!=="https://www.facebook.com"||location.pathname!=="/"||Array.from(document.querySelectorAll('[role="dialog"]')).some(visible))return false;const ids=Array.from(document.querySelectorAll(p.selectors.identity)).filter(visible);const buttons=Array.from(document.querySelectorAll(p.selectors.openComposer)).filter(e=>visible(e)&&e.innerText.trim()===p.openComposerText);if(ids.length!==1||ids[0].href!==p.identityHref||buttons.length!==1||buttons[0].getAttribute("aria-disabled")==="true")return false;buttons[0].click();return true;})()`,
        },
        5000,
      );
      await response.body?.cancel();
      current = await wait("composer");
      if (current.stage === "composer" && current.verified) draft.composer = current;
      return summary(draft, current.verified ? "reviewed" : current.stage);
    }
    const observed = await observe(slot);
    let draft = drafts.get(slot.run.id);
    if (input.operation === "activate") {
      if (
        writing ||
        !draft ||
        draft.deadline <= now ||
        hash(draft) !== input.candidateHash ||
        !draft.entry ||
        !draft.composer ||
        !draft.receipt
      )
        throw new Error("setup_review_stale");
      // Recheck the empty composer and exact audience at activation; a stale view never grants capability.
      if (
        observed.verified !== true ||
        observed.stage !== "composer" ||
        JSON.stringify(observed) !== JSON.stringify(draft.composer)
      )
        throw new Error("setup_page_changed");
      writing = true;
      try {
        const p = validateFacebookProfile(
          upgradeGeneratedPublicationProfile({
            version: 1,
            channelRef: slot.run.channelRef,
            accountRef: slot.run.accountRef,
            reviewRef: `evidence-${randomUUID()}`,
            reviewedAt: new Date(now).toISOString(),
            expiresAt: new Date(now + 7 * 86400000).toISOString(),
            url: "https://www.facebook.com/",
            identityHref: draft.entry.identityHref,
            receiptUrl: draft.receipt.identityHref,
            audienceText: draft.composer.audienceText,
            openComposerText: draft.entry.openComposerText,
            textOnly: true,
            resolvePostLinks: true,
            selectors: {
              ...draft.composer.selectors,
              ...draft.receipt.selectors,
              ...draft.entry.selectors,
              composerIdentity: draft.composer.selectors.composerIdentity,
              postHover: draft.receipt.selectors.postLink,
            },
          }),
        );
        if ([draft.composer, draft.receipt].some((v) => v.identityHref !== p.identityHref))
          throw new Error("setup_identity_changed");
        const next = new Map(profiles);
        next.set(key(p), p);
        if (next.size > 16) throw new Error("setup_limit");
        const temp = join(directory, `${randomUUID()}.tmp`);
        const fd = await open(temp, "wx", 0o600);
        try {
          await fd.writeFile(JSON.stringify([...next.values()]));
          await fd.sync();
        } finally {
          await fd.close();
        }
        try {
          assertActive(slot);
          await activate(slot, p, input.candidateHash);
          assertActive(slot);
          await rename(temp, join(directory, "reviewed.json"));
        } finally {
          await unlink(temp).catch(() => {});
        }
        // The platform checks the same active owner session and refuses queued publication work.
        profiles.set(key(p), p);
        const result = {
          ...summary(draft, "ready", true),
          textOnly: p.textOnly === true,
          audience: "Public",
        };
        activated.set(slot.run.id, { hash: input.candidateHash, result });
        return result;
      } finally {
        writing = false;
      }
    }
    if (!draft) {
      draft = { deadline: now + 10 * 60_000 };
      drafts.set(slot.run.id, draft);
    }
    if (observed.verified === true && ["entry", "composer", "receipt"].includes(observed.stage))
      draft[observed.stage] = observed;
    return summary(draft, observed.verified ? "reviewed" : observed.stage);
  }
  return {
    initialize,
    scopes,
    async handle(slot, input) {
      if (running.has(slot.run.id)) throw new Error("setup_already_running");
      running.add(slot.run.id);
      try {
        return await perform(slot, input);
      } finally {
        running.delete(slot.run.id);
      }
    },
    async execute(context) {
      const p = profiles.get(key(context.run));
      if (!p || Date.parse(p.expiresAt) <= Date.now()) return "failed";
      return createPublicationExecutor(createFacebookDriver(p, context.browserRequest))(context);
    },
  };
}
