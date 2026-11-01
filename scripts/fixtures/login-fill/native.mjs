import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { firefox } from "playwright-core";
import { launchOptions } from "/app/official-runtime/node_modules/camoufox/dist/index.js";
import { createAutomaticLoginRuntime } from "/app/plugins/ftrade-login/automatic-runtime.js";
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
  const context = await browser.newContext();
  const page = await context.newPage();
  const base = "https://www.facebook.com";
  await context.route("**/*", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/"
        ? `<form id="login_form" method="post"><input name="email"><input name="pass" type="password"><div role="button" tabindex="0" aria-label="Log In">Log in</div></form><script>
      for(const input of document.querySelectorAll('input'))input.oninput=event=>{if(!event.isTrusted)input.value='';};
      document.querySelector('[name=pass]').addEventListener('input',()=>{if(!document.querySelector('[aria-label="Show password"]'))document.querySelector('form').insertAdjacentHTML('beforeend','<div role="button" tabindex="0" aria-label="Show password"></div>');});
      document.querySelector('[aria-label="Log In"]').onclick=()=>{location.href='/two_step_verification/two_factor/?encrypted_context=synthetic&flow=two_factor_login&next';};</script>`
        : path === "/two_step_verification/two_factor/"
          ? `<h2>Go to your authentication app</h2><form><input type="text" autocomplete="off"><input type="submit" hidden></form><div role="button" tabindex="-1" aria-disabled="true">Continue</div><script>
        document.querySelector('input').oninput=()=>{const b=document.querySelector('[role=button]');b.setAttribute('tabindex','0');b.setAttribute('aria-disabled','false');};
        document.querySelector('[role=button]').onclick=()=>location.href='/messages/';</script>`
          : '<a id="identity" data-account-id="123456789">Account</a><div id="chats"><span id="empty">No chats</span></div>';
    return route.fulfill({ contentType: "text/html", body });
  });
  const accountId = randomUUID(),
    runId = randomUUID();
  const profile = {
    version: 2,
    reviewRef: "evidence-native-root-totp",
    reviewedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    url: base + "/",
    form: "#login_form",
    username: '#login_form input[name="email"]',
    password: '#login_form input[name="pass"]',
    formActionMode: "facebook-root-implicit",
    automation: {
      accountRef: "123456789",
      identity: { selector: "#identity", attribute: "data-account-id" },
      passwordSubmit: '#login_form [role="button"][tabindex="0"][aria-label="Log In"]',
      totp: {
        mode: "facebook-authenticator",
        url: base + "/two_step_verification/two_factor/",
        marker: "h2",
        input: 'form input[type="text"][autocomplete="off"]',
        submit: '[role="button"]',
      },
      pin: { url: base + "/messages/", marker: "#pin", input: "#pin-code", submit: null },
      ready: {
        url: base + "/messages/",
        marker: "#chats",
        empty: "#empty",
        emptyText: "No chats",
        thread: "#thread",
      },
      checkpoint: "#checkpoint",
      rejected: "#rejected",
      loading: "#loading",
    },
  };
  const runtime = createAutomaticLoginRuntime({
    sessions: new Map([
      [accountId, { tabGroups: new Map([[runId, new Map([["tab", { page }]])]]) }],
    ]),
    accountId,
    runId,
    profile,
    leaseDeadline: () => Date.now() + 60000,
  });
  const packet = {
    userId: accountId,
    runId,
    tabId: "tab",
    requestId: randomUUID(),
    expiresAt: Date.now() + 30000,
  };
  await page.goto(base + "/");
  assert.equal(
    (
      await runtime("submit", {
        ...packet,
        phase: "password",
        values: { username: "123456789", password: "synthetic-secret" },
      })
    ).outcome,
    "submitted",
  );
  await page.waitForURL((url) => url.pathname === "/two_step_verification/two_factor/");
  assert.equal((await runtime("observe", { ...packet })).state, "totp");
  assert.equal(
    (
      await runtime("submit", {
        ...packet,
        phase: "totp",
        values: { code: "123456", expiresAt: packet.expiresAt },
      })
    ).outcome,
    "submitted",
  );
  await page.waitForURL(base + "/messages/");
  assert.equal((await runtime("observe", { ...packet })).state, "ready");
  assert.equal(
    (
      await runtime("submit", {
        ...packet,
        phase: "totp",
        values: { code: "123456", expiresAt: packet.expiresAt },
      })
    ).outcome,
    "refused",
  );
  await context.close();
  console.log("PASS automatic native password and authenticator TOTP continuation");
} finally {
  await browser.close();
}
