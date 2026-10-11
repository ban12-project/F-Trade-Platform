import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { join } from "node:path";

const program = await readFile(
  new URL("./publication-inspection-page.js", import.meta.url),
  "utf8",
);
const keys = [
  "identity",
  "openComposer",
  "composer",
  "textbox",
  "submit",
  "audience",
  "fileInput",
  "attachmentName",
];
const stages = new Set(["active", "tab", "candidate", "browser", "response"]);
export class PublicationInspectionFailure extends Error {
  constructor(stage) {
    super("inspection_unavailable");
    if (!stages.has(stage)) throw new Error("inspection_stage_invalid");
    this.stage = stage;
  }
}
export function publicationInspectionFailureStage(error) {
  return error instanceof PublicationInspectionFailure ? error.stage : null;
}
async function checkedStage(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PublicationInspectionFailure) throw error;
    throw new PublicationInspectionFailure(stage);
  }
}
export async function readPublicationInspectionCandidate(directory, run) {
  if (!directory) throw new Error("inspection_candidate_unavailable");
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700)
    throw new Error("inspection_candidate_unavailable");
  const fd = await open(
    join(directory, "publication.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const s = await fd.stat();
    if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600 || s.size > 64000)
      throw new Error("inspection_candidate_unavailable");
    const source = await fd.readFile("utf8");
    if (Buffer.byteLength(source) > 64000) throw new Error("inspection_candidate_unavailable");
    const profiles = JSON.parse(source);
    if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > 16)
      throw new Error("inspection_candidate_unavailable");
    const matching = profiles.filter(
      (p) => p.accountRef === run.accountRef && p.channelRef === run.channelRef,
    );
    if (matching.length !== 1) throw new Error("inspection_candidate_unavailable");
    const p = matching[0],
      expires = Date.parse(p.expiresAt);
    if (
      p.version !== 1 ||
      !Number.isFinite(expires) ||
      typeof p.audienceText !== "string" ||
      !p.audienceText.trim() ||
      p.audienceText.length > 100
    )
      throw new Error("inspection_candidate_unavailable");
    const href = new URL(p.identityHref);
    if (
      href.origin !== "https://www.facebook.com" ||
      href.username ||
      href.password ||
      href.hash ||
      href.pathname === "/"
    )
      throw new Error("inspection_candidate_unavailable");
    const selectors = {};
    for (const k of [...keys, "composerIdentity"]) {
      const v = p.selectors?.[k];
      if (k === "composerIdentity" && v === undefined) continue;
      if (typeof v !== "string" || !v.trim() || v.length > 500 || v.includes(","))
        throw new Error("inspection_candidate_unavailable");
      selectors[k] = v;
    }
    const profile = { identityHref: p.identityHref, audienceText: p.audienceText, selectors };
    if (p.videoReceipt) {
      if (
        typeof p.videoReceipt.container !== "string" ||
        !p.videoReceipt.container.trim() ||
        p.videoReceipt.container.length > 500 ||
        p.videoReceipt.container.includes(",") ||
        typeof p.videoReceipt.successText !== "string" ||
        !p.videoReceipt.successText.trim() ||
        p.videoReceipt.successText.length > 500
      )
        throw new Error("inspection_candidate_unavailable");
      profile.videoReceipt = {
        container: p.videoReceipt.container,
        successText: p.videoReceipt.successText,
      };
    }
    // Expired candidate files are observable inputs, never activation authority. Bytes/dates remain unchanged.
    return {
      profile,
      candidateHash: createHash("sha256").update(source).digest("hex"),
      candidateExpiresAt: new Date(expires).toISOString(),
      candidateExpired: expires <= Date.now(),
    };
  } finally {
    await fd.close();
  }
}
export function createPublicationPageInspector({
  directory,
  browserRequest,
  assertActive,
  candidate = readPublicationInspectionCandidate,
}) {
  return async (slot) => {
    const active = () => checkedStage("active", () => assertActive(slot));
    await active();
    if (
      typeof slot.interactiveTabId !== "string" ||
      !slot.interactiveTabId ||
      slot.run.kind !== "interactive"
    )
      throw new PublicationInspectionFailure("tab");
    const value = await checkedStage("candidate", () => candidate(directory, slot.run));
    await active();
    const response = await checkedStage("browser", () =>
      browserRequest(
        slot,
        `/tabs/${encodeURIComponent(slot.interactiveTabId)}/evaluate`,
        {
          userId: slot.run.accountId,
          // Upstream intentionally sanitizes thrown page errors. Catch inside
          // this fixed program boundary and return only a predetermined marker.
          expression: `(() => { try { return (${program})(${JSON.stringify(value.profile)}); } catch (error) { return { inspectionFailure: error?.message === "inspection_page_unavailable" ? "tab" : error?.name === "SyntaxError" ? "candidate" : "response" }; } })()`,
        },
        5000,
      ),
    );
    return checkedStage("response", async () => {
      if (!response.body) throw new Error("inspection_response_invalid");
      const reader = response.body.getReader(),
        chunks = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          length += chunk.length;
          if (length > 8192) throw new Error("inspection_response_invalid");
          chunks.push(chunk);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body.ok !== true || !body.result) throw new Error("inspection_response_invalid");
      await active();
      if (Object.hasOwn(body.result, "inspectionFailure")) {
        if (
          Object.keys(body.result).length !== 1 ||
          !["tab", "candidate", "response"].includes(body.result.inspectionFailure)
        )
          throw new Error("inspection_response_invalid");
        throw new PublicationInspectionFailure(body.result.inspectionFailure);
      }
      const observation = body.result,
        controls = {};
      for (const key of keys) {
        const count = observation.controls?.[key];
        if (!Number.isInteger(count) || count < 0 || count > 25)
          throw new Error("inspection_response_invalid");
        controls[key] = count;
      }
      if (
        typeof observation.identityMatched !== "boolean" ||
        !Number.isInteger(observation.videoPreviewCount) ||
        observation.videoPreviewCount < 0 ||
        observation.videoPreviewCount > 25
      )
        throw new Error("inspection_response_invalid");
      const result = {
        version: 1,
        observedAt: new Date().toISOString(),
        candidateHash: value.candidateHash,
        candidateExpiresAt: value.candidateExpiresAt,
        candidateExpired: Date.parse(value.candidateExpiresAt) <= Date.now(),
        identityMatched: observation.identityMatched,
        controls,
        videoPreviewCount: observation.videoPreviewCount,
      };
      for (const key of [
        "composerIdentityMatched",
        "composerEmpty",
        "audienceMatchesCandidate",
        "videoReceiptVisible",
      ]) {
        if (observation[key] !== null && typeof observation[key] !== "boolean")
          throw new Error("inspection_response_invalid");
        result[key] = observation[key];
      }
      return result;
    });
  };
}
