import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createFacebookLiveInboxAgent, validateLiveInboxProfile } from "./facebook-inbox-agent.mjs";

const program = await readFile(new URL("./inbox-setup-page.js", import.meta.url), "utf8");
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

export function createInboxSetup({
  stateDir,
  managedDirectory,
  browserRequest,
  assertActive,
  activate,
}) {
  const directory = join(stateDir, "inbox-setup");
  const profiles = new Map();
  const drafts = new Map();
  const running = new Set();
  const activated = new Map();
  let writing = false;

  const scopes = () =>
    [...profiles.values()]
      .filter((p) => Date.parse(p.expiresAt) > Date.now())
      .map((p) => ({
        channelRef: p.channelRef,
        accountRef: p.accountRef,
        expiresAt: Date.parse(p.expiresAt),
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
    for (const p of values) {
      const expires = Date.parse(p?.expiresAt);
      validateLiveInboxProfile(p, expires <= Date.now() ? expires - 1 : Date.now());
      if (profiles.has(key(p))) throw new Error("setup_profiles_duplicate");
      profiles.set(key(p), p);
    }
  }

  async function expectedIdentity(run) {
    const configured = await privateJson(join(managedDirectory, "login.json"));
    const matches = configured.filter((p) => key(p) === key(run));
    const expected = matches.length === 1 ? matches[0].profile?.automation?.accountRef : null;
    if (!/^[0-9]{5,30}$/.test(expected ?? "")) throw new Error("setup_identity_unconfigured");
    return expected;
  }

  async function observe(slot, expectedAccountRef) {
    assertActive(slot);
    if (slot.run.kind !== "interactive" || !slot.interactiveTabId)
      throw new Error("setup_run_invalid");
    const response = await browserRequest(
      slot,
      `/tabs/${encodeURIComponent(slot.interactiveTabId)}/evaluate`,
      {
        userId: slot.run.accountId,
        expression: `(() => { try { return (${program})(${JSON.stringify(expectedAccountRef)}); } catch { return { stage: "page", verified: false, threadCount: 0, emptyInbox: false }; } })()`,
      },
      5000,
    );
    if (!response.ok || !response.body) throw new Error("setup_page_unavailable");
    const reader = response.body.getReader();
    const parts = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 4096) throw new Error("setup_response_invalid");
        parts.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
    assertActive(slot);
    const r = body.result;
    if (
      body.ok !== true ||
      !r ||
      !["inbox", "identity", "attention", "page"].includes(r.stage) ||
      typeof r.verified !== "boolean" ||
      !Number.isInteger(r.threadCount) ||
      r.threadCount < 0 ||
      r.threadCount > 200 ||
      typeof r.emptyInbox !== "boolean"
    )
      throw new Error("setup_response_invalid");
    return r;
  }

  function summary(draft, observed, active = false) {
    const complete = Boolean(draft?.verified);
    return {
      version: 1,
      stage: active ? "ready" : observed.verified ? "reviewed" : observed.stage,
      inboxVerified: observed.verified,
      threadCount: observed.threadCount,
      emptyInbox: observed.emptyInbox,
      candidateHash: complete ? hash(draft) : null,
      active,
      observedAt: new Date().toISOString(),
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

    const expectedAccountRef = await expectedIdentity(slot.run);

    if (input.operation === "prepare") {
      // Read-only navigation to /messages/ only. Never sends, replies, or clicks threads.
      assertActive(slot);
      const navResponse = await browserRequest(
        slot,
        `/tabs/${encodeURIComponent(slot.interactiveTabId)}/navigate`,
        { userId: slot.run.accountId, url: "https://www.facebook.com/messages/" },
        15000,
      );
      await navResponse.body?.cancel();
      if (!navResponse.ok) throw new Error("setup_navigation_failed");
      let current;
      for (let attempt = 0; attempt < 24; attempt++) {
        current = await observe(slot, expectedAccountRef);
        if (current.verified && current.stage === "inbox") break;
        if (current.stage === "attention" || current.stage === "identity") break;
        await delay(500);
      }
      if (current.verified && current.stage === "inbox") {
        const draft = {
          deadline: now + 10 * 60_000,
          expectedAccountRef,
          channelRef: slot.run.channelRef,
          accountRef: slot.run.accountRef,
          verified: true,
        };
        drafts.set(slot.run.id, draft);
        return summary(draft, current);
      }
      return summary(null, current);
    }

    const observed = await observe(slot, expectedAccountRef);
    let draft = drafts.get(slot.run.id);

    if (input.operation === "activate") {
      if (
        writing ||
        !draft ||
        draft.deadline <= now ||
        hash(draft) !== input.candidateHash ||
        !draft.verified ||
        draft.channelRef !== slot.run.channelRef ||
        draft.accountRef !== slot.run.accountRef
      )
        throw new Error("setup_review_stale");
      if (observed.verified !== true || observed.stage !== "inbox")
        throw new Error("setup_page_changed");
      writing = true;
      try {
        const profile = validateLiveInboxProfile({
          version: 2,
          mode: "facebook-live-agent",
          channelRef: slot.run.channelRef,
          accountRef: slot.run.accountRef,
          expectedAccountRef: draft.expectedAccountRef,
          reviewRef: `evidence-${randomUUID()}`,
          reviewedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 7 * 86400000).toISOString(),
          url: "https://www.facebook.com/messages/",
        });
        const next = new Map(profiles);
        next.set(key(profile), profile);
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
          await activate(slot, profile, input.candidateHash);
          assertActive(slot);
          await rename(temp, join(directory, "reviewed.json"));
        } finally {
          await unlink(temp).catch(() => {});
        }
        profiles.set(key(profile), profile);
        const result = summary(draft, observed, true);
        activated.set(slot.run.id, { hash: input.candidateHash, result });
        return result;
      } finally {
        writing = false;
      }
    }

    if (observed.verified && observed.stage === "inbox") {
      draft = {
        deadline: now + 10 * 60_000,
        expectedAccountRef,
        channelRef: slot.run.channelRef,
        accountRef: slot.run.accountRef,
        verified: true,
      };
      drafts.set(slot.run.id, draft);
    }
    return summary(draft, observed);
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
      return createFacebookLiveInboxAgent(
        p,
        context.browserRequest,
        context.decideInboxAction,
      )(context);
    },
  };
}
