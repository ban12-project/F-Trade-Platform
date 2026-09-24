import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const program = readFileSync("ops/browser-node/facebook-publication-page.js", "utf8");
const profile = {
  expiresAt: "2999-01-01T00:00:00.000Z",
  accountRef: "synthetic-account",
  channelRef: "facebook-personal",
  identityHref: "https://www.facebook.com/synthetic-account",
  audienceText: "Only me",
  selectors: {
    composer: "#composer",
    composerIdentity: "#acting-account",
    identity: "#acting-account",
    audience: "#audience",
    textbox: "#caption",
    submit: "#submit",
    attachmentName: ".attachment-name",
  },
};

test("empty Facebook contenteditable newline is an empty approved caption", async ({ page }) => {
  await page.route("https://www.facebook.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div id="composer"><a id="acting-account" href="https://www.facebook.com/synthetic-account">Account</a><button id="audience">Only me</button><div id="caption" contenteditable="true"><br></div><button id="submit">Post</button></div>`,
    }),
  );
  await page.goto("https://www.facebook.com/synthetic-account");
  const inspect = () =>
    page.evaluate(
      async ({ program, profile }) => {
        const inspected = new Function(`return (${program})`)();
        return inspected(profile, { kind: "inspect" });
      },
      { program, profile },
    );
  expect(
    await page.locator("#caption").evaluate((element) => (element as HTMLElement).innerText),
  ).toBe("\n");
  expect((await inspect()).text).toBe("");
  await page.locator("#caption").fill("SYNTHETIC approved copy");
  expect((await inspect()).text).toBe("SYNTHETIC approved copy");
});
