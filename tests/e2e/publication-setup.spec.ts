import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const program = readFileSync("ops/browser-node/publication-setup-page.js", "utf8");
const expected = "10000123456789",
  href = `https://www.facebook.com/profile.php?id=${expected}`;
const entry = `<nav role="navigation" aria-label="Shortcuts"><a href="${href}">Synthetic</a></nav><button role="button">What's on your mind, Synthetic?</button>`;
const composer = `<div role="dialog"><a aria-label="Synthetic's Timeline" href="${href}">Synthetic</a><div role="textbox" contenteditable="true"></div><button role="button" aria-label="Post" disabled>Post</button><button aria-label="Edit privacy. Only me">Only me</button><input type="file"></div>`;
test("read-only setup discovers exact account and empty composer without posting or reading private text", async ({
  page,
}) => {
  await page.route("https://www.facebook.com/**", (r) =>
    r.fulfill({ contentType: "text/html", body: entry }),
  );
  await page.goto("https://www.facebook.com/");
  const inspect = () =>
    page.evaluate(({ program, expected }) => new Function(`return (${program})`)()(expected), {
      program,
      expected,
    });
  expect(await inspect()).toMatchObject({ stage: "entry", verified: true, identityHref: href });
  await page.setContent(composer);
  const before = await page.content();
  expect(await inspect()).toMatchObject({
    stage: "composer",
    verified: true,
    audienceText: "Only me",
  });
  expect(await page.content()).toBe(before);
  await page.getByRole("textbox").fill("SYNTHETIC PRIVATE DRAFT");
  expect(await inspect()).toEqual({ stage: "draft" });
  await page.setContent(composer.replace(expected, "99999999999999"));
  expect(await inspect()).toEqual({ stage: "identity" });
  await page.setContent(composer.replace("Only me</button>", "Custom</button>"));
  expect(await inspect()).toEqual({ stage: "audience" });
});
test("setup automatically checks service and keeps authentication errors actionable", async ({
  page,
}) => {
  await page.goto("/testing/publication-page-inspection");
  await expect(page.getByText(/配置未生效。请确认接管页面仍在运行/)).toBeVisible();
  await expect(page.getByRole("button", { name: "登录完成，重试连接" })).toBeVisible();
  await expect(
    page.getByText(
      "新发布的范围为公开（所有人）。本步骤只检查账号和页面，不上传素材、不发布帖子。",
    ),
  ).toBeVisible();
});

test("an existing profile-photo update can verify result structure without requiring a test text post", async ({
  page,
}) => {
  const post = `<a aria-label="Synthetic's Timeline" href="${href}">Synthetic</a><div aria-posinset="1"><h2><a href="${href}">Synthetic</a></h2><div><div><span><span data-ad-rendering-role="profile_name">Synthetic</span></span></div><div><a href="https://www.facebook.com/photo.php?fbid=123">Yesterday</a></div></div><img alt="SYNTHETIC profile photo"></div>`;
  await page.route("https://www.facebook.com/**", (r) =>
    r.fulfill({ contentType: "text/html", body: post }),
  );
  await page.goto(href);
  const inspect = () =>
    page.evaluate(({ program, expected }) => new Function(`return (${program})`)()(expected), {
      program,
      expected,
    });
  const result = await inspect();
  expect(result).toMatchObject({ stage: "receipt", verified: true });
  expect(result.selectors.post).toBe('[aria-posinset]:has([data-ad-preview="message"])');
  await page
    .locator("h2 a")
    .evaluate((a) => a.setAttribute("href", "https://www.facebook.com/profile.php?id=999999999"));
  expect(await inspect()).toEqual({ stage: "receipt" });
});
