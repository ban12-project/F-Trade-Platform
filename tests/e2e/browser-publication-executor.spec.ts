import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { publicationFailureLabel } from "../../lib/social/publication-presentation";
import { createPublicationExecutor } from "../../ops/browser-node/publication-executor.mjs";

const accountRef = "synthetic-account";
const channelRef = "synthetic-channel";
const postRef = "https://www.facebook.com/synthetic/posts/12345";
type Mode =
  | "success"
  | "identity"
  | "baseline"
  | "prepare"
  | "changed"
  | "expired"
  | "click_lost"
  | "receipt_lost"
  | "receipt_once_lost"
  | "observe_lost"
  | "old_post"
  | "aborted";
async function scenario(
  page: Page,
  mode: Mode,
  format: "text" | "image" | "video" = "text",
  observationError = new Error("private page text must not escape"),
) {
  const events: string[] = [];
  const controller = new AbortController();
  const receipts: Array<Record<string, unknown>> = [];
  const payload = {
    accountRef,
    channelRef,
    format,
    text: "SYNTHETIC approved copy",
    ...(format === "text" ? {} : { media: { sha256: "a".repeat(64) } }),
  };
  const driver = {
    async open() {
      await page.setContent(
        `<textarea aria-label="Copy"></textarea><input type="file" aria-label="Attachment"><button id="publish">Publish synthetic fixture</button><output id="count">0</output><a id="result"></a><script>document.querySelector('#publish').onclick=()=>{document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1);document.querySelector('#result').href='${postRef}';}</script>`,
      );
      return page;
    },
    async identity() {
      return { accountRef: mode === "identity" ? "different" : accountRef, channelRef };
    },
    async existingPublicationRefs() {
      if (mode === "baseline") throw new Error("private timeline text must not escape");
      return mode === "old_post" ? [postRef] : [];
    },
    async prepare(_session: Page, content: typeof payload, upload: { path: string } | null) {
      events.push("prepare");
      if (mode === "prepare") throw new Error("private editor text must not escape");
      await page.getByLabel("Copy").fill(content.text);
      if (upload)
        await page.getByLabel("Attachment").setInputFiles({
          name: upload.path.split("/").at(-1)!,
          mimeType: format === "image" ? "image/png" : "video/mp4",
          buffer: Buffer.from("SYNTHETIC file"),
        });
    },
    async inspect() {
      events.push("inspect");
      const files = await page
        .getByLabel("Attachment")
        .evaluate((input: HTMLInputElement) => [...(input.files ?? [])].map((file) => file.name));
      return {
        accountRef,
        channelRef,
        text: await page.getByLabel("Copy").inputValue(),
        readyToPublish: true,
        attachmentCount: files.length,
        attachmentName: files[0],
        attachmentSha256: format === "video" ? "a".repeat(64) : undefined,
      };
    },
    async publish() {
      events.push("click");
      await page.getByRole("button", { name: "Publish synthetic fixture" }).click();
      if (mode === "click_lost") throw new Error("response_lost_after_click");
    },
    async observe() {
      if (mode === "observe_lost") {
        if (observationError.name === "AbortError") controller.abort();
        throw observationError;
      }
      return {
        accountRef,
        channelRef,
        text: await page.getByLabel("Copy").inputValue(),
        externalPublicationRef: await page.locator("#result").getAttribute("href"),
      };
    },
    async close() {
      events.push("close");
    },
  };
  const result = await createPublicationExecutor(driver)({
    run: { kind: "publish", accountRef, channelRef, publication: payload },
    signal: controller.signal,
    async preparePublicationMedia() {
      events.push("media");
      return {
        path: `/tmp/ftrade-uploads/${"a".repeat(64)}.${format === "image" ? "png" : "mp4"}`,
        media: { sha256: "a".repeat(64) },
      };
    },
    async authorizePublication() {
      events.push("authorize");
      if (mode === "aborted") controller.abort();
      if (mode === "changed")
        await page.getByLabel("Copy").fill("SYNTHETIC changed while authorizing");
      return {
        authorizationId: randomUUID(),
        localExpiresAt: Date.now() + (mode === "expired" ? -1 : 30000),
      };
    },
    async reportPublication(receipt: Record<string, unknown>) {
      receipts.push(receipt);
      if (mode === "receipt_once_lost" && receipts.length === 1) throw new Error("response_lost");
      if (mode === "receipt_lost") throw new Error("response_lost");
    },
    onPreclickFailure(stage: string, code: string) {
      events.push(`preclick:${stage}:${code}`);
    },
  });
  return { result, events, receipts, clicks: Number(await page.locator("#count").textContent()) };
}

for (const [message, category] of [
  ["browser_request_failed", "transport_failed"],
  ["facebook_composer_closed_timeout", "composer_pending"],
  ["facebook_identity_ready_timeout", "identity_unavailable"],
  ["facebook_posts_ready_timeout", "feed_unavailable"],
  ["facebook_posts_loaded_timeout", "feed_empty"],
  ["facebook_permalink_hover_failed", "link_resolution_failed"],
  ["facebook_permalink_unresolved", "link_unresolved"],
  ["facebook_navigation_invalid", "navigation_failed"],
  ["facebook_evaluation_failed", "page_contract_failed"],
  ["facebook_browser_response_invalid", "response_invalid"],
  ["facebook_post_ambiguous", "post_ambiguous"],
  ["facebook_video_receipt_ambiguous", "video_ambiguous"],
  ["facebook_video_receipt_not_observed", "video_unverified"],
  ["facebook_receipt_post_missing", "matching_post_missing"],
  ["facebook_receipt_baseline_only", "baseline_only"],
  ["facebook_receipt_identity_mismatch", "receipt_identity_mismatch"],
  ["facebook_receipt_video_missing", "video_missing"],
  ["facebook_receipt_reel_link_unverified", "reel_link_unverified"],
  ["facebook_post_not_observed", "post_unverified"],
  ["facebook_profile_expired", "review_expired"],
] as const) {
  test(`observation failure preserves the fixed ${category} classification without retrying`, async ({
    page,
  }) => {
    const run = await scenario(page, "observe_lost", "video", new Error(message));
    expect(run.result).toBe("unknown");
    expect(run.clicks).toBe(1);
    expect(run.receipts).toHaveLength(1);
    expect(run.receipts[0].failureCode).toBe(`publication_observe_${category}`);
    expect(publicationFailureLabel(String(run.receipts[0].failureCode))).toBeTruthy();
    expect(JSON.stringify(run.receipts)).not.toContain(message);
  });
}

test("observation diagnostics redact unknown errors and distinguish request timeouts", async ({
  page,
}) => {
  const privateMessage = "facebook_permalink_unresolved private-account private-caption";
  const unknown = await scenario(page, "observe_lost", "video", new Error(privateMessage));
  expect(unknown.receipts[0].failureCode).toBe("publication_observe_unknown");
  expect(JSON.stringify(unknown.receipts)).not.toContain(privateMessage);
  const timeout = new Error(privateMessage);
  timeout.name = "TimeoutError";
  const timedOut = await scenario(page, "observe_lost", "video", timeout);
  expect(timedOut.receipts[0].failureCode).toBe("publication_observe_request_timeout");
  expect(timedOut.clicks).toBe(1);
  const aborted = new Error(privateMessage);
  aborted.name = "AbortError";
  const cancelled = await scenario(page, "observe_lost", "video", aborted);
  expect(cancelled.receipts[0].failureCode).toBe("publication_observe_cancelled");
  expect(cancelled.clicks).toBe(1);
  expect(publicationFailureLabel(privateMessage)).toBeNull();
});

for (const format of ["text", "image", "video"] as const) {
  test(`publication executor prepares and publishes ${format} once on a synthetic page`, async ({
    page,
  }) => {
    const run = await scenario(page, "success", format);
    expect(run.result).toBe("completed");
    expect(run.clicks).toBe(1);
    expect(run.receipts).toHaveLength(1);
    expect(run.receipts[0].outcome).toBe("published");
    expect(run.events.indexOf("authorize")).toBeGreaterThan(run.events.indexOf("prepare"));
    expect(run.events.filter((event) => event === "inspect")).toHaveLength(2);
    expect(run.events.at(-1)).toBe("close");
  });
}
for (const mode of ["identity", "baseline", "prepare", "changed", "expired", "aborted"] as const) {
  test(`publication executor refuses ${mode} before clicking`, async ({ page }) => {
    const run = await scenario(page, mode);
    expect(run.result).toBe("failed");
    expect(run.clicks).toBe(0);
    expect(run.receipts).toHaveLength(0);
  });
}
for (const [mode, stage] of [
  ["identity", "identity"],
  ["baseline", "baseline"],
  ["prepare", "prepare"],
  ["changed", "recheck"],
  ["expired", "authorization_deadline"],
  ["aborted", "authorize"],
] as const) {
  test(`pre-click failure exposes only the fixed ${stage} stage`, async ({ page }) => {
    const run = await scenario(page, mode);
    expect(run.events.filter((event) => event.startsWith("preclick:"))).toEqual([
      `preclick:${stage}:${mode === "expired" ? "publication_authorization_expired" : mode === "changed" ? "publication_preview_text_mismatch" : "unclassified"}`,
    ]);
    expect(run.events.join(" ")).not.toContain("private ");
  });
}
for (const mode of ["click_lost", "receipt_lost", "old_post"] as const) {
  test(`publication executor does not repeat clicks after ${mode}`, async ({ page }) => {
    const run = await scenario(page, mode);
    expect(run.result).toBe("unknown");
    expect(run.clicks).toBe(1);
    expect(run.receipts).toHaveLength(mode === "receipt_lost" ? 3 : 1);
    expect(
      run.receipts.every((receipt) => JSON.stringify(receipt) === JSON.stringify(run.receipts[0])),
    ).toBe(true);
    expect(run.receipts[0].outcome).toBe(mode === "receipt_lost" ? "published" : "unknown");
  });
}

test("lost receipt response retries the same observation without another click", async ({
  page,
}) => {
  const run = await scenario(page, "receipt_once_lost");
  expect(run.result).toBe("completed");
  expect(run.clicks).toBe(1);
  expect(run.receipts).toHaveLength(2);
  expect(run.receipts[0]).toEqual(run.receipts[1]);
});
for (const [mode, phase] of [
  ["click_lost", "publish"],
  ["observe_lost", "observe"],
  ["old_post", "validate"],
] as const) {
  test(`unknown result records only the fixed ${phase} phase`, async ({ page }) => {
    const run = await scenario(page, mode);
    expect(run.result).toBe("unknown");
    expect(run.clicks).toBe(1);
    expect(run.receipts[0].failureCode).toBe(`publication_${phase}_unknown`);
    expect(run.events.some((event) => event.startsWith("preclick:"))).toBe(false);
  });
}
