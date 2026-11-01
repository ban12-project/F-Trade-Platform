import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const program = readFileSync("ops/browser-node/facebook-publication-page.js", "utf8");
const profile = {
  expiresAt: "2999-01-01T00:00:00.000Z",
  accountRef: "synthetic-account",
  channelRef: "facebook-personal",
  identityHref: "https://www.facebook.com/synthetic-account",
  audienceText: "Public",
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
      body: `<div id="composer"><a id="acting-account" href="https://www.facebook.com/synthetic-account">Account</a><button id="audience">Public</button><div id="caption" contenteditable="true"><br></div><button id="submit">Post</button></div>`,
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

for (const variant of [
  "labelledby",
  "missing",
  "duplicate",
  "outside",
  "wrong",
  "multiple_options",
] as const) {
  test(`audience names use exact scoped ARIA references: ${variant}`, async ({ page }) => {
    const label = `<span id="label">${variant === "wrong" ? "Public and friends" : "Public"}</span>`;
    const radio = '<input type="radio" aria-labelledby="label" aria-describedby="description">';
    await page.route("https://www.facebook.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `${variant === "outside" ? label : ""}<section id="privacy">${["missing", "outside"].includes(variant) ? "" : label}${variant === "duplicate" ? label : ""}<span id="description">Anyone on or off Facebook</span>${radio}${variant === "multiple_options" ? radio : ""}<input type="checkbox"><button>Done</button></section>`,
      }),
    );
    await page.goto("https://www.facebook.com/synthetic");
    const probe = () =>
      page.evaluate(
        ({ program, profile }) =>
          new Function(`return (${program})`)()(
            {
              ...profile,
              audienceSelection: {
                dialog: "#privacy",
                option: 'input[type="radio"]',
                optionLabel: "Public",
                defaultCheckbox: 'input[type="checkbox"]',
                confirm: "button",
              },
            },
            { kind: "audience-picker-ready" },
          ),
        { program, profile },
      );
    if (variant === "multiple_options")
      await expect(probe()).rejects.toThrow("facebook_control_ambiguous");
    else expect(await probe()).toBe(variant === "labelledby");
  });
}
