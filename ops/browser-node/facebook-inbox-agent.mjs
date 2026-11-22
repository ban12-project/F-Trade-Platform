import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pagePrograms from "./page-programs.cjs";

const pageProgram = pagePrograms.inboxLive;

export function validateLiveInboxProfile(value, now = Date.now()) {
  if (
    value?.version !== 2 ||
    value?.mode !== "facebook-live-agent" ||
    ![value.channelRef, value.accountRef].every(
      (v) => typeof v === "string" && v.trim() && v.length <= 160,
    ) ||
    !/^[0-9]{5,30}$/.test(value.expectedAccountRef ?? "") ||
    !/^evidence-[a-z0-9_-]{3,120}$/i.test(value.reviewRef ?? "")
  )
    throw new Error("inbox_profile_invalid");
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
    throw new Error("inbox_profile_expired");
  const url = new URL(value.url);
  if (url.href !== "https://www.facebook.com/messages/")
    throw new Error("inbox_profile_origin_invalid");
  return structuredClone(value);
}

/** Build a compact, privacy-preserving structural excerpt of Playwright ariaSnapshot(). */
export function summarizeAriaSnapshot(rawSnapshot) {
  if (typeof rawSnapshot !== "string" || !rawSnapshot.trim()) return "(empty snapshot)";
  const lines = [];
  let length = 0;
  for (const rawLine of rawSnapshot.split("\n")) {
    const clean = rawLine.replace(/"([^"]{60,})"/g, (_m, inner) => `"${inner.slice(0, 40)}..."`);
    if (length + clean.length + 1 > 3500) break;
    lines.push(clean);
    length += clean.length + 1;
  }
  return lines.join("\n") || "(empty snapshot)";
}

async function boundedJson(response) {
  if (!response.ok || !response.body) throw new Error("inbox_browser_response_invalid");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) throw new Error("inbox_response_limit");
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

function threadReferenceKey(threads) {
  return JSON.stringify(threads.map((item) => `${item.conversationRef}\0${item.url}`).sort());
}

function hashSnapshot(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function validateAgentCommand(command) {
  return (
    command &&
    typeof command === "object" &&
    !Array.isArray(command) &&
    Object.keys(command).sort().join(",") === "action,target,valueRef" &&
    ["read", "navigate", "click", "input", "scroll", "upload", "finish"].includes(command.action) &&
    typeof command.target === "string" &&
    command.target.length <= 80 &&
    typeof command.valueRef === "string" &&
    command.valueRef.length <= 80
  );
}

const SAFE_INBOX_FAILURE_CODES = new Set([
  "inbox_cancelled",
  "inbox_browser_response_invalid",
  "inbox_response_limit",
  "inbox_navigation_invalid",
  "inbox_snapshot_invalid",
  "inbox_read_failed",
  "inbox_loading_timeout",
  "inbox_scope_invalid",
  "inbox_list_changed",
  "inbox_agent_invalid_action",
  "inbox_agent_unverified_finish",
  "inbox_agent_no_progress",
  "inbox_agent_incomplete",
  "inbox_scan_size_limit",
  "inbox_profile_expired",
  "inbox_profile_invalid",
  "inbox_profile_origin_invalid",
  "inbox_messages_invalid",
  "inbox_receipt_invalid",
  "inbox_reporter_unavailable",
  "inbox_run_invalid",
  "inbox_messages_limit",
  "browser_request_failed",
  "browser_request_stopped",
  "browser_request_queue_full",
  "local_lease_expired",
  "publication_lease_inactive",
  "egress_ip_invalid",
  "egress_tab_invalid",
  "egress_response_missing",
  "egress_response_limit",
  "egress_navigation_invalid",
  "egress_observation_invalid",
  "egress_ip_mismatch",
]);

function classifyInboxFailure(error) {
  if (["needs_login", "needs_2fa", "checkpoint", "page_contract_failed"].includes(error?.attention))
    return error.attention;
  const message = error?.message;
  if (typeof message === "string") {
    if (SAFE_INBOX_FAILURE_CODES.has(message) || /^platform_http_[45][0-9]{2}$/.test(message))
      return message;
  }
  return "inbox_unclassified";
}

// Route A Browser Agent Inbox Driver:
// The Browser Agent (ariaSnapshot + capability handles) drives navigation across
// discovered threads; deterministic host verification remains sole authority for
// identity, message IDs, direction, timestamps, and signed completion receipts.
export function createFacebookLiveInboxAgent(input, browserRequest, decideInboxAction) {
  const profile = validateLiveInboxProfile(input);
  return async ({ run, signal, reportInbound, onInboxFailure, onInboxThreadStats }) => {
    const scanStartedAt = new Date().toISOString();
    const active = () => {
      validateLiveInboxProfile(profile);
      if (signal.aborted) throw new Error("inbox_cancelled");
    };
    let tabId;

    const navigateTo = async (url) => {
      active();
      const tab = await boundedJson(
        await browserRequest(tabId ? `/tabs/${encodeURIComponent(tabId)}/navigate` : "/tabs", {
          userId: run.accountId,
          sessionKey: run.id,
          url,
          trace: false,
        }),
      );
      if (
        tab.ok !== true ||
        !tab.tabId ||
        typeof tab.tabId !== "string" ||
        tab.tabId.length > 200 ||
        (tabId && tab.tabId !== tabId)
      )
        throw new Error("inbox_navigation_invalid");
      const current = new URL(tab.url);
      if (current.origin !== "https://www.facebook.com")
        throw new Error("inbox_navigation_invalid");
      tabId = tab.tabId;
      return current.href;
    };

    const readAriaSnapshot = async () => {
      active();
      const qs = new URLSearchParams({
        userId: run.accountId,
        format: "json",
        includeScreenshot: "false",
      });
      const data = await boundedJson(
        await browserRequest(`/tabs/${encodeURIComponent(tabId)}/snapshot?${qs.toString()}`),
      );
      if (data.ok !== true || typeof data.snapshot !== "string")
        throw new Error("inbox_snapshot_invalid");
      return summarizeAriaSnapshot(data.snapshot);
    };

    const evaluateLive = async (mode, conversationRef) => {
      for (let attempt = 0; attempt < 24; attempt++) {
        active();
        const result = await boundedJson(
          await browserRequest(`/tabs/${encodeURIComponent(tabId)}/evaluate`, {
            userId: run.accountId,
            expression: `(${pageProgram})(${JSON.stringify(profile)},${JSON.stringify(mode)},${JSON.stringify(conversationRef ?? null)})`,
          }),
        );
        if (!result.ok || !result.result) throw new Error("inbox_read_failed");
        if (result.result.retry === "loading") {
          if (attempt === 23) throw new Error("inbox_loading_timeout");
          await delay(500, undefined, { signal });
          continue;
        }
        if (
          ["needs_login", "needs_2fa", "checkpoint", "page_contract_failed"].includes(
            result.result.attention,
          )
        ) {
          const error = new Error("inbox_operator_attention");
          error.attention = result.result.attention;
          throw error;
        }
        if (mode === "thread" && result.result.rowCount === 0 && attempt < 10) {
          await delay(500, undefined, { signal });
          continue;
        }
        return { ...result.result, attempts: attempt + 1 };
      }
      throw new Error("inbox_loading_timeout");
    };

    try {
      if (
        run.kind !== "inbox" ||
        !run.id ||
        !run.accountId ||
        run.channelRef !== profile.channelRef ||
        run.accountRef !== profile.accountRef ||
        typeof decideInboxAction !== "function"
      )
        throw new Error("inbox_scope_invalid");

      await navigateTo(profile.url);
      const initialList = await evaluateLive("list");
      const initialThreads = initialList.threads.map((thread, index) => ({
        handle: `thread-${index}`,
        conversationRef: thread.conversationRef,
        url: thread.url,
      }));
      const expectedListKey = threadReferenceKey(initialThreads);

      let currentAria = await readAriaSnapshot();
      let currentView = "inbox-home";
      let finalListRechecked = initialThreads.length === 0;
      const visitedMessages = new Map();

      const handles = [
        ...initialThreads.map((thread) => ({
          action: "navigate",
          target: thread.handle,
          label: `Open verified Messenger thread handle ${thread.handle}`,
          async execute() {
            await navigateTo(thread.url);
            const result = await evaluateLive("thread", thread.conversationRef);
            const rawStats = result.stats && typeof result.stats === "object" ? result.stats : {};
            onInboxThreadStats?.({
              rows: Number(rawStats.rows ?? result.rowCount ?? 0),
              inLog: Number(rawStats.inLog ?? 0),
              inMain: Number(rawStats.inMain ?? 0),
              inDocMsgId: Number(rawStats.inDocMsgId ?? 0),
              inDocVisibleMsgId: Number(rawStats.inDocVisibleMsgId ?? 0),
              dialogs: Number(rawStats.dialogs ?? 0),
              progressbars: Number(rawStats.progressbars ?? 0),
              inbound: Number(rawStats.inbound ?? result.messages?.length ?? 0),
              outbound: Number(rawStats.outbound ?? 0),
              skippedNonText: Number(rawStats.skippedNonText ?? result.skippedNonText ?? 0),
              attempts: Number(result.attempts ?? 1),
            });
            currentView = thread.handle;
            currentAria = await readAriaSnapshot();
            visitedMessages.set(thread.handle, result.messages);
          },
        })),
        {
          action: "navigate",
          target: "inbox-home",
          label: "Return to Messenger inbox list and confirm thread list is unchanged",
          async execute() {
            await navigateTo(profile.url);
            const list = await evaluateLive("list");
            if (threadReferenceKey(list.threads) !== expectedListKey)
              throw new Error("inbox_list_changed");
            currentView = "inbox-home";
            currentAria = await readAriaSnapshot();
            finalListRechecked = true;
          },
        },
      ];

      const observe = () => {
        const unvisited = initialThreads.filter((thread) => !visitedMessages.has(thread.handle));
        const controls = handles
          .filter((handle) =>
            handle.target === "inbox-home"
              ? unvisited.length === 0 && !finalListRechecked
              : !visitedMessages.has(handle.target),
          )
          .map((handle) => ({
            id: handle.target,
            label: handle.label,
            actions: ["navigate"],
          }));
        const statePayload = {
          currentView,
          discoveredThreadCount: initialThreads.length,
          visitedHandles: [...visitedMessages.keys()],
          remainingHandles: unvisited.map((thread) => thread.handle),
          finalListRechecked,
          ariaExcerpt: currentAria,
        };
        let state = JSON.stringify(statePayload);
        if (state.length > 12_000) {
          state = JSON.stringify({
            ...statePayload,
            ariaExcerpt: currentAria.slice(0, 2000),
          });
        }
        return { controls, state };
      };

      const verify = () =>
        visitedMessages.size === initialThreads.length &&
        initialThreads.every((thread) => visitedMessages.has(thread.handle)) &&
        finalListRechecked === true;

      const maxCalls = Math.min(40, Math.max(6, initialThreads.length * 2 + 4));
      let snapshot = observe();
      let unchanged = 0;
      const recentActions = [];
      let verifiedCompletion = false;

      for (let call = 1; call <= maxCalls; call++) {
        active();
        const decision = await decideInboxAction({
          snapshot,
          context: {
            remainingCalls: maxCalls - call,
            unchangedObservations: unchanged,
            recentActions: recentActions.map((entry) => ({ ...entry })),
          },
        });
        const command = decision?.command;
        if (!validateAgentCommand(command)) throw new Error("inbox_agent_invalid_action");

        if (command.action === "finish") {
          if (!verify()) throw new Error("inbox_agent_unverified_finish");
          verifiedCompletion = true;
          break;
        }

        if (command.action !== "read") {
          // Only host-issued navigate capability handles are accepted.
          if (command.action !== "navigate" || command.valueRef !== "")
            throw new Error("inbox_agent_invalid_action");
          const capability = handles.find((item) => item.target === command.target);
          if (!capability) throw new Error("inbox_agent_invalid_action");
          await capability.execute();
        } else {
          currentAria = await readAriaSnapshot();
        }

        const next = observe();
        const changed = hashSnapshot(next) !== hashSnapshot(snapshot);
        recentActions.push({ action: command.action, changed });
        if (recentActions.length > 6) recentActions.shift();
        unchanged = changed ? 0 : unchanged + 1;
        snapshot = next;
        if (unchanged >= 3) throw new Error("inbox_agent_no_progress");
      }

      if (!verifiedCompletion) throw new Error("inbox_agent_incomplete");

      let messageCount = 0;
      let pending = [];
      for (const thread of initialThreads) {
        const messages = visitedMessages.get(thread.handle) ?? [];
        for (const message of messages) {
          active();
          if (messageCount >= 200) throw new Error("inbox_scan_size_limit");
          pending.push(message);
          messageCount++;
          if (pending.length === 10) {
            await reportInbound(pending, new Date().toISOString());
            pending = [];
          }
        }
      }
      if (pending.length) {
        active();
        await reportInbound(pending, new Date().toISOString());
      }
      active();
      await reportInbound([], new Date().toISOString(), {
        reviewRef: profile.reviewRef,
        scanStartedAt,
        coverage: "visible_inbox",
        conversationCount: initialThreads.length,
        messageCount,
      });
      return "completed";
    } catch (error) {
      onInboxFailure?.(classifyInboxFailure(error));
      if (
        ["needs_login", "needs_2fa", "checkpoint", "page_contract_failed"].includes(
          error?.attention,
        )
      )
        return error.attention;
      if (
        ["inbox_scan_size_limit", "inbox_profile_expired", "inbox_navigation_invalid"].includes(
          error?.message,
        )
      )
        return "page_contract_failed";
      // Never leak raw message bodies, selector text, or internal errors into logs.
      return "failed";
    }
  };
}
