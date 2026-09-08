import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { createPublicationExecutor } from "../../ops/browser-node/publication-executor.mjs";

const accountRef = "synthetic-account";
const channelRef = "synthetic-channel";
const postRef = "https://www.facebook.com/synthetic/posts/12345";
type Mode =
  | "success"
  | "identity"
  | "changed"
  | "expired"
  | "click_lost"
  | "receipt_lost"
  | "old_post"
  | "aborted";
async function scenario(page: Page, mode: Mode, format: "text" | "image" | "video" = "text") {
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
      return mode === "old_post" ? [postRef] : [];
    },
    async prepare(_session: Page, content: typeof payload, upload: { path: string } | null) {
      events.push("prepare");
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
      };
    },
    async publish() {
      events.push("click");
      await page.getByRole("button", { name: "Publish synthetic fixture" }).click();
      if (mode === "click_lost") throw new Error("response_lost_after_click");
    },
    async observe() {
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
      if (mode === "receipt_lost") throw new Error("response_lost");
    },
  });
  return { result, events, receipts, clicks: Number(await page.locator("#count").textContent()) };
}

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
for (const mode of ["identity", "changed", "expired", "aborted"] as const) {
  test(`publication executor refuses ${mode} before clicking`, async ({ page }) => {
    const run = await scenario(page, mode);
    expect(run.result).toBe("failed");
    expect(run.clicks).toBe(0);
    expect(run.receipts).toHaveLength(0);
  });
}
for (const mode of ["click_lost", "receipt_lost", "old_post"] as const) {
  test(`publication executor does not repeat clicks after ${mode}`, async ({ page }) => {
    const run = await scenario(page, mode);
    expect(run.result).toBe("unknown");
    expect(run.clicks).toBe(1);
    expect(run.receipts).toHaveLength(1);
    expect(run.receipts[0].outcome).toBe(mode === "receipt_lost" ? "published" : "unknown");
  });
}
