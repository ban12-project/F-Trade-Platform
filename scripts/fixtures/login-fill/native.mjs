import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { launchOptions } from "camoufox-js";
import { firefox } from "playwright-core";
import { createLoginFill } from "/app/plugins/ftrade-login/index.js";

const browser = await firefox.launch(
  await launchOptions({ headless: true, geoip: false, os: "linux", exclude_addons: ["UBO"] }),
);
try {
  for (const mode of ["trusted-only", "replace-password", "change-origin"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<form id="login_form" method="post"><input name="email"><input name="pass" type="password"><button>Log in</button></form>',
      }),
    );
    await page.goto("https://www.facebook.com/");
    await page.evaluate((mode) => {
      window.syntheticSubmissions = 0;
      document.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        window.syntheticSubmissions++;
      });
      for (const input of document.querySelectorAll("input"))
        input.addEventListener("input", (event) => {
          if (!event.isTrusted) input.value = "";
        });
      document.querySelector('[name="email"]').addEventListener("input", () => {
        if (mode === "replace-password")
          document.querySelector('[name="pass"]').outerHTML = '<input name="pass" type="password">';
        if (mode === "change-origin") location.href = "https://evil.invalid/";
      });
    }, mode);
    const accountId = randomUUID(),
      runId = randomUUID();
    const profile = {
      version: 1,
      reviewRef: "evidence-offline-native-input",
      reviewedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      url: "https://www.facebook.com/",
      form: "#login_form",
      username: '#login_form input[name="email"]',
      password: '#login_form input[name="pass"]',
      formActionMode: "facebook-root-implicit",
    };
    const fill = createLoginFill({
      sessions: new Map([
        [accountId, { tabGroups: new Map([[runId, new Map([["tab", { page }]])]]) }],
      ]),
      accountId,
      runId,
      kind: "interactive",
      profile,
      leaseDeadline: () => Date.now() + 60000,
    });
    const packet = () => ({
      requestId: randomUUID(),
      runId,
      userId: accountId,
      tabId: "tab",
      username: "synthetic@example.invalid",
      password: "synthetic-only-test",
      expiresAt: Date.now() + 20000,
    });
    const outcome = await fill(packet());
    assert.equal(outcome.outcome, mode === "trusted-only" ? "filled" : "unknown");
    if (mode === "change-origin") await page.waitForURL("https://evil.invalid/");
    assert.equal(
      await page.locator('[name="pass"]').inputValue(),
      mode === "trusted-only" ? "synthetic-only-test" : "",
    );
    assert.equal((await fill(packet())).outcome, "refused");
    assert.equal(await page.evaluate(() => window.syntheticSubmissions ?? 0), 0);
    await context.close();
    console.log(`PASS native login fill ${mode}`);
  }
} finally {
  await browser.close();
}
