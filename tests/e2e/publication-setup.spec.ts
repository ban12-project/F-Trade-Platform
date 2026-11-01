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
test("setup UI offers automation, requires completed review and handles unauthenticated access without activating", async ({
  page,
}) => {
  await page.goto("/testing/publication-page-inspection");
  await expect(page.getByRole("button", { name: "自动核对发布功能（不发帖）" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认以上范围，让文字发布配置生效" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "自动核对发布功能（不发帖）" }).click();
  await expect(page.getByText(/配置未生效。请确认接管页面仍在运行/)).toBeVisible();
});
