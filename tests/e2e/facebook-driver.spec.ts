import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createFacebookDriver,
  validateFacebookProfile,
} from "../../ops/browser-node/facebook-driver.mjs";
import { createPublicationExecutor } from "../../ops/browser-node/publication-executor.mjs";

const profile = {
  version: 1,
  accountRef: "synthetic-account",
  channelRef: "synthetic-channel",
  reviewRef: "evidence-synthetic-dom-only",
  reviewedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  url: "https://www.facebook.com/synthetic",
  identityHref: "https://www.facebook.com/synthetic-owner",
  selectors: {
    identity: "#identity",
    openComposer: "#open",
    composer: "#composer",
    textbox: "textarea",
    submit: "button",
    fileInput: "input",
    attachmentName: ".filename",
    post: "article",
    postAuthor: ".author",
    postText: ".copy",
    postLink: ".permalink",
  },
};
const fixture = `<!doctype html><a id="identity" href="${profile.identityHref}">Synthetic identity</a><button id="open">Open</button><section id="composer" hidden><textarea></textarea><input type="file"><span class="filename" hidden></span><button>Post</button></section><output id="clicks">0</output><script>
const composer=document.querySelector('#composer');
document.querySelector('#open').onclick=()=>composer.hidden=false;
composer.querySelector('input').onchange=(e)=>{const name=composer.querySelector('.filename');name.textContent=e.target.files[0].name;name.hidden=false;};
composer.querySelector('button').onclick=()=>{const count=document.querySelector('#clicks');count.textContent=String(Number(count.textContent)+1);const post=document.createElement('article');const author=document.createElement('a');author.className='author';author.href='${profile.identityHref}';author.textContent='Synthetic author';const copy=document.createElement('p');copy.className='copy';copy.textContent=composer.querySelector('textarea').value;const link=document.createElement('a');link.className='permalink';link.href='https://www.facebook.com/synthetic/posts/'+count.textContent;link.textContent='Synthetic post';post.append(author,copy,link);document.body.append(post);};
</script>`;

for (const mode of [
  "text",
  "image",
  "video",
  "identity_changed",
  "duplicate_composer",
  "wrong_attachment",
  "transit_expiry",
  "extra_file_input",
] as const) {
  test(`Camofox DOM driver ${mode} using intercepted synthetic HTML`, async ({ page, context }) => {
    // Every request is intercepted; no Facebook request or account is used.
    await context.route("**/*", (route) =>
      route.request().url() === profile.url
        ? route.fulfill({ contentType: "text/html", body: fixture })
        : route.abort(),
    );
    const format =
      mode === "video"
        ? "video"
        : ["image", "wrong_attachment", "extra_file_input"].includes(mode)
          ? "image"
          : "text";
    const sha256 = "a".repeat(64);
    const path = `/tmp/ftrade-uploads/${sha256}.${format === "video" ? "mp4" : "png"}`;
    const requests: string[] = [];
    const browserRequest = async (endpoint: string, body: Record<string, unknown> = {}) => {
      requests.push(endpoint);
      if (endpoint === "/tabs") {
        expect(body.trace).toBe(false);
        await page.goto(String(body.url));
        if (mode === "extra_file_input")
          await page.evaluate(() => {
            const input = document.createElement("input");
            input.type = "file";
            document.body.prepend(input);
          });
        return Response.json({ tabId: "synthetic-tab", url: profile.url });
      }
      if (endpoint.endsWith("/evaluate")) {
        const expression = String(body.expression);
        if (mode === "transit_expiry" && expression.includes('"kind":"publish"')) {
          // Move only the page clock beyond the authorization during transport.
          await page.clock.install({ time: new Date(Date.now() + 60000) });
        }
        return Response.json({ ok: true, result: await page.evaluate(expression) });
      }
      if (endpoint.endsWith("/type")) {
        expect(body.submit).toBe(false);
        expect(body.pressEnter).toBe(false);
        await page.locator(String(body.selector)).fill(String(body.text));
        return Response.json({ ok: true });
      }
      if (endpoint.endsWith("/upload")) {
        expect(body.path).toBe(path);
        await page.locator('input[type="file"]').setInputFiles({
          name: path.split("/").at(-1)!,
          mimeType: format === "video" ? "video/mp4" : "image/png",
          buffer: Buffer.from("SYNTHETIC media"),
        });
        if (mode === "wrong_attachment")
          await page.locator(".filename").evaluate((element) => {
            element.textContent = "wrong.png";
          });
        return Response.json({ ok: true, attached: [path] });
      }
      throw new Error("Unapproved browser endpoint");
    };
    const receipts: Array<Record<string, unknown>> = [];
    let authorized = 0;
    const result = await createPublicationExecutor(createFacebookDriver(profile, browserRequest))({
      run: {
        id: randomUUID(),
        accountId: randomUUID(),
        kind: "publish",
        accountRef: profile.accountRef,
        channelRef: profile.channelRef,
        publication: {
          accountRef: profile.accountRef,
          channelRef: profile.channelRef,
          text: "SYNTHETIC approved copy",
          format,
          ...(format === "text" ? {} : { media: { sha256 } }),
        },
      },
      signal: new AbortController().signal,
      async preparePublicationMedia() {
        return { path, media: { sha256 } };
      },
      async authorizePublication() {
        authorized++;
        if (mode === "identity_changed")
          await page.locator("#identity").evaluate((element) => {
            element.setAttribute("href", "https://www.facebook.com/different-owner");
          });
        if (mode === "duplicate_composer")
          await page.locator("#composer").evaluate((element) => {
            element.after(element.cloneNode(true));
          });
        return { authorizationId: randomUUID(), localExpiresAt: Date.now() + 30000 };
      },
      async reportPublication(receipt) {
        receipts.push(receipt);
      },
    });
    const success = ["text", "image", "video"].includes(mode);
    expect(result).toBe(success ? "completed" : mode === "transit_expiry" ? "unknown" : "failed");
    expect(await page.locator("#clicks").textContent()).toBe(success ? "1" : "0");
    expect(receipts).toHaveLength(success || mode === "transit_expiry" ? 1 : 0);
    if (mode === "transit_expiry") expect(receipts[0].outcome).toBe("unknown");
    expect(requests.some((url) => url.endsWith("/click"))).toBe(false);
    if (["wrong_attachment", "extra_file_input"].includes(mode)) expect(authorized).toBe(0);
  });
}
test("DOM profiles require a current review and fixed Facebook origin", () => {
  expect(() =>
    validateFacebookProfile({ ...profile, expiresAt: new Date(0).toISOString() }),
  ).toThrow();
  expect(() => validateFacebookProfile({ ...profile, url: "https://example.invalid/" })).toThrow();
  expect(() => validateFacebookProfile({ ...profile, reviewRef: "" })).toThrow();
  expect(() => validateFacebookProfile({ ...profile, accountRef: "" })).toThrow();
  expect(() =>
    validateFacebookProfile({ ...profile, identityHref: "https://www.facebook.com/" }),
  ).toThrow();
});
