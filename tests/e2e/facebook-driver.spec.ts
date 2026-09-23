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
  audienceText: "Only me",
  selectors: {
    identity: "#identity",
    openComposer: "#open",
    composer: "#composer",
    textbox: "textarea",
    submit: "button",
    audience: ".audience",
    fileInput: "input",
    attachmentName: ".filename",
    post: "article",
    postAuthor: ".author",
    postText: ".copy",
    postLink: ".permalink",
  },
};
const fixture = `<!doctype html><a id="identity" href="${profile.identityHref}">Synthetic identity</a><button id="open">Open</button><section id="composer" hidden><span class="audience">Only me</span><textarea></textarea><input type="file"><span class="filename" hidden></span><button>Post</button></section><output id="clicks">0</output><script>
const composer=document.querySelector('#composer');
document.querySelector('#open').onclick=()=>composer.hidden=false;
composer.querySelector('input').onchange=(e)=>{const name=composer.querySelector('.filename');name.textContent=e.target.files[0].name;name.hidden=false;};
composer.querySelector('button').onclick=()=>{const count=document.querySelector('#clicks');count.textContent=String(Number(count.textContent)+1);const post=document.createElement('article');const author=document.createElement('a');author.className='author';author.href='${profile.identityHref}';author.textContent='Synthetic author';const copy=document.createElement('p');copy.className='copy';copy.textContent=composer.querySelector('textarea').value;const link=document.createElement('a');link.className='permalink';link.href='https://www.facebook.com/synthetic/posts/'+count.textContent;link.textContent='Synthetic post';post.append(author,copy,link);document.body.append(post);};
</script>`;

for (const mode of [
  "text",
  "baseline_duplicate",
  "post_link_hover",
  "post_link_hover_receipt",
  "post_link_hover_detached",
  "post_link_unresolved",
  "post_author_changed",
  "image",
  "video",
  "identity_changed",
  "audience_changed",
  "audience_missing",
  "audience_transit_change",
  "audience_selection",
  "audience_default_changed",
  "audience_selection_wrong",
  "composer_identity_tracking",
  "composer_identity_changed",
  "duplicate_composer",
  "wrong_attachment",
  "transit_expiry",
  "extra_file_input",
  "upload_replaces_composer",
  "hidden_duplicate_composer",
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
        : ["image", "wrong_attachment", "extra_file_input", "upload_replaces_composer"].includes(
              mode,
            )
          ? "image"
          : "text";
    const sha256 = "a".repeat(64);
    const path = `/tmp/ftrade-uploads/${sha256}.${format === "video" ? "mp4" : "png"}`;
    const requests: string[] = [];
    let postReadFailures = 0;
    const browserRequest = async (endpoint: string, body: Record<string, unknown> = {}) => {
      requests.push(endpoint);
      if (endpoint === "/tabs") {
        expect(body.trace).toBe(false);
        await page.goto(String(body.url));
        if (mode.startsWith("audience_selection") || mode === "audience_default_changed")
          await page.evaluate((scenario) => {
            const composer = document.querySelector<HTMLElement>("#composer");
            const audience = document.querySelector<HTMLElement>(".audience");
            if (!composer || !audience) throw new Error("fixture missing");
            audience.textContent = "Friends";
            audience.onclick = () => {
              composer.hidden = true;
              const dialog = document.createElement("section");
              dialog.id = "privacy";
              dialog.innerHTML =
                '<label>Only me<input id="only-me" type="radio"></label><input id="default" type="checkbox" checked><button id="done">Done</button>';
              document.body.append(dialog);
              const option = dialog.querySelector<HTMLInputElement>("#only-me");
              const checkbox = dialog.querySelector<HTMLInputElement>("#default");
              const confirm = dialog.querySelector<HTMLButtonElement>("#done");
              if (!option || !checkbox || !confirm) throw new Error("fixture missing");
              option.onclick = () => {
                checkbox.checked = scenario === "audience_default_changed";
              };
              confirm.onclick = () => {
                audience.textContent =
                  scenario === "audience_selection_wrong" ? "Public" : "Only me";
                dialog.remove();
                composer.hidden = false;
              };
            };
          }, mode);
        if (mode.startsWith("composer_identity"))
          await page.evaluate(
            ({ href, changed }) => {
              const identity = document.createElement("a");
              identity.id = "composer-identity";
              identity.href = changed ? `${href}?id=different` : `${href}?__tn__=%3C`;
              identity.textContent = "Synthetic acting identity";
              document.querySelector("#composer")?.append(identity);
            },
            { href: profile.identityHref, changed: mode === "composer_identity_changed" },
          );
        if (mode === "extra_file_input")
          await page.evaluate(() => {
            const input = document.createElement("input");
            input.type = "file";
            document.body.prepend(input);
          });
        if (mode === "baseline_duplicate")
          await page.evaluate((owner) => {
            const post = document.createElement("article");
            post.innerHTML =
              '<a class="author">Author</a><p class="copy">SYNTHETIC approved copy</p><a class="permalink" href="https://www.facebook.com/profile.php#placeholder">Old link</a>';
            post.querySelector("a")?.setAttribute("href", owner);
            document.body.append(post);
          }, profile.identityHref);
        if (mode.startsWith("post_"))
          await page.evaluate((scenario) => {
            const composer = document.querySelector<HTMLElement>("#composer");
            const submit = composer?.querySelector("button");
            if (!composer || !submit) throw new Error("fixture missing");
            submit.addEventListener("click", () => {
              const author = document.querySelector<HTMLAnchorElement>("article .author");
              const link = document.querySelector<HTMLAnchorElement>("article .permalink");
              if (!author || !link) throw new Error("fixture missing");
              author.href +=
                scenario === "post_author_changed"
                  ? "?id=wrong"
                  : "?__cft__[0]=tracking&__tn__=tracking";
              link.href = "https://www.facebook.com/profile.php#placeholder";
              link.onmouseenter = () => {
                if (scenario !== "post_link_unresolved")
                  link.href =
                    "https://www.facebook.com/synthetic/posts/1/?__cft__[0]=tracking&__tn__=tracking";
              };
              composer.hidden = true;
            });
          }, mode);
        return Response.json({ tabId: "synthetic-tab", url: profile.url });
      }
      if (endpoint.endsWith("/navigate")) {
        expect([profile.url, profile.identityHref]).toContain(body.url);
        await page.evaluate((url) => history.replaceState(null, "", url), String(body.url));
        return Response.json({ ok: true });
      }
      if (endpoint === "/act") {
        expect(body.kind).toBe("hover");
        await page.locator(String(body.selector)).hover();
        if (mode === "post_link_hover_detached")
          return Response.json({ code: "element_not_actionable" }, { status: 422 });
        return Response.json({ ok: true });
      }
      if (endpoint.endsWith("/evaluate")) {
        const expression = String(body.expression);
        if (
          mode === "post_link_hover_detached" &&
          expression.includes('"kind":"posts"') &&
          (await page.locator("article").count()) &&
          postReadFailures++ === 0
        )
          return Response.json({ error: "synthetic transition" }, { status: 500 });
        if (mode === "transit_expiry" && expression.includes('"kind":"publish"')) {
          // Move only the page clock beyond the authorization during transport.
          await page.clock.install({ time: new Date(Date.now() + 60000) });
        }
        if (mode === "audience_transit_change" && expression.includes('"kind":"publish"'))
          await page.locator(".audience").evaluate((element) => {
            element.textContent = "Public";
          });
        return Response.json({ ok: true, result: await page.evaluate(expression) });
      }
      if (endpoint.endsWith("/type")) {
        expect(body.submit).toBe(false);
        expect(body.pressEnter).toBe(false);
        const target = page.locator(String(body.selector));
        if (body.mode === "keyboard") await target.pressSequentially(String(body.text));
        else {
          expect(body.mode).toBe("fill");
          expect(body.text).toBe("");
          await target.fill(String(body.text));
        }
        return Response.json({ ok: true });
      }
      if (endpoint.endsWith("/upload")) {
        expect(body.path).toBe(path);
        await page.locator('input[type="file"]').setInputFiles({
          name: path.split("/").at(-1)!,
          mimeType: format === "video" ? "video/mp4" : "image/png",
          buffer: Buffer.from("SYNTHETIC media"),
        });
        if (mode === "upload_replaces_composer")
          await page.locator("#composer").evaluate((element) => {
            const stale = element.cloneNode(true) as HTMLElement;
            const field = stale.querySelector("textarea");
            if (!field) throw new Error("synthetic_textbox_missing");
            field.value = "SYNTHETIC stale text must not be submitted";
            const wrapper = document.createElement("div");
            wrapper.setAttribute("aria-hidden", "true");
            wrapper.append(stale);
            element.before(wrapper);
            // The active composer survives with a reset field, as in a fresh
            // Facebook media composer. Its post handler is retained.
            const active = element.querySelector("textarea");
            if (!active) throw new Error("synthetic_textbox_missing");
            active.value = "";
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
    const scopedProfile = {
      ...profile,
      resolvePostLinks: mode.startsWith("post_"),
      ...(mode === "post_link_hover_receipt" ? { receiptUrl: profile.identityHref } : {}),
      selectors: {
        ...profile.selectors,
        ...(mode === "post_link_hover_receipt" ? { receiptIdentity: "#identity" } : {}),
        ...(mode.startsWith("composer_identity") ? { composerIdentity: "#composer-identity" } : {}),
      },
      ...(mode.startsWith("audience_selection") || mode === "audience_default_changed"
        ? {
            audienceSelection: {
              dialog: "#privacy",
              option: "input[type=radio]",
              optionLabel: "Only me",
              defaultCheckbox: "#default",
              confirm: "#done",
            },
          }
        : {}),
    };
    const result = await createPublicationExecutor(
      createFacebookDriver(scopedProfile, browserRequest),
    )({
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
        if (mode === "audience_changed")
          await page.locator(".audience").evaluate((element) => {
            element.textContent = "Friends";
          });
        if (mode === "audience_missing")
          await page.locator(".audience").evaluate((element) => element.remove());
        if (mode === "identity_changed")
          await page.locator("#identity").evaluate((element) => {
            element.setAttribute("href", "https://www.facebook.com/different-owner");
          });
        if (mode === "hidden_duplicate_composer")
          await page.locator("#composer").evaluate((element) => {
            const wrapper = document.createElement("div");
            wrapper.setAttribute("aria-hidden", "true");
            wrapper.append(element.cloneNode(true));
            element.before(wrapper);
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
    const success = [
      "text",
      "post_link_hover",
      "post_link_hover_receipt",
      "post_link_hover_detached",
      "image",
      "video",
      "upload_replaces_composer",
      "hidden_duplicate_composer",
      "audience_selection",
      "composer_identity_tracking",
    ].includes(mode);
    const uncertain = [
      "transit_expiry",
      "audience_transit_change",
      "post_link_unresolved",
      "post_author_changed",
    ].includes(mode);
    expect(result).toBe(success ? "completed" : uncertain ? "unknown" : "failed");
    expect(await page.locator("#clicks").textContent()).toBe(
      success || mode.startsWith("post_") ? "1" : "0",
    );
    expect(receipts).toHaveLength(success || uncertain ? 1 : 0);
    if (uncertain) expect(receipts[0].outcome).toBe("unknown");
    if (mode === "post_link_hover")
      expect(receipts[0].externalPublicationRef).toBe("https://www.facebook.com/synthetic/posts/1");
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
  expect(() => validateFacebookProfile({ ...profile, audienceText: "" })).toThrow();
  expect(() => validateFacebookProfile({ ...profile, accountRef: "" })).toThrow();
  expect(() =>
    validateFacebookProfile({ ...profile, identityHref: "https://www.facebook.com/" }),
  ).toThrow();
});

test("text-only reviewed profiles reject media before browser navigation", async () => {
  let requests = 0;
  const driver = createFacebookDriver({ ...profile, textOnly: true }, async () => {
    requests++;
    throw new Error("must not navigate");
  });
  await expect(
    driver.open(
      {
        kind: "publish",
        accountRef: profile.accountRef,
        channelRef: profile.channelRef,
        publication: {
          accountRef: profile.accountRef,
          channelRef: profile.channelRef,
          text: "SYNTHETIC",
          format: "video",
        },
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow("facebook_profile_format_unreviewed");
  expect(requests).toBe(0);
});

test("baseline resolves existing post permalinks before publication", async ({ page, context }) => {
  const receiptProfile = {
    ...profile,
    receiptUrl: profile.identityHref,
    resolvePostLinks: true,
    selectors: { ...profile.selectors, receiptIdentity: "#identity", postHover: ".permalink" },
  };
  const oldRef = "https://www.facebook.com/synthetic/posts/old";
  await context.route("**/*", (route) =>
    [profile.url, profile.identityHref].includes(route.request().url())
      ? route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><a id="identity" href="${profile.identityHref}">Identity</a>
            <article><a class="author" href="${profile.identityHref}">Author</a>
            <p class="copy">An older synthetic post</p>
            <a class="permalink" href="https://www.facebook.com/profile.php#placeholder">Time</a></article>
            <script>document.querySelector('.permalink').onmouseenter = (event) => {
              event.currentTarget.href = '${oldRef}';
            }</script>`,
        })
      : route.abort(),
  );
  const calls: string[] = [];
  const browserRequest = async (endpoint: string, body: Record<string, unknown> = {}) => {
    calls.push(endpoint);
    if (endpoint === "/tabs") {
      await page.goto(String(body.url));
      return Response.json({ tabId: "synthetic-tab", url: body.url });
    }
    if (endpoint.endsWith("/navigate")) {
      await page.goto(String(body.url));
      return Response.json({ ok: true });
    }
    if (endpoint.endsWith("/evaluate"))
      return Response.json({ ok: true, result: await page.evaluate(String(body.expression)) });
    if (endpoint === "/act") {
      await page.locator(String(body.selector)).hover();
      return Response.json({ code: "element_not_actionable" }, { status: 422 });
    }
    throw new Error("Unapproved browser endpoint");
  };
  const driver = createFacebookDriver(receiptProfile, browserRequest);
  const session = await driver.open(
    {
      id: randomUUID(),
      accountId: randomUUID(),
      accountRef: profile.accountRef,
      channelRef: profile.channelRef,
      publication: { format: "text" },
    },
    new AbortController().signal,
  );
  expect(await driver.identity(session)).toEqual({
    accountRef: profile.accountRef,
    channelRef: profile.channelRef,
  });
  expect(await driver.existingPublicationRefs(session)).toEqual([oldRef]);
  expect(calls).toContain("/act");
});
