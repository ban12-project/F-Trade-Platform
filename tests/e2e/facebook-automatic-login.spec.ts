import { expect, test } from "@playwright/test";
import { createAutomaticLoginRuntime } from "../../ops/browser-node/login-plugin/automatic-runtime.js";
import { validateLoginProfile } from "../../ops/browser-node/login-plugin/index.js";

test("reviewed automatic page contract submits password, TOTP and PIN once and verifies identity", async ({
  page,
}) => {
  const base = "https://www.facebook.com";
  await page.route(`${base}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const content =
      path === "/login/"
        ? `<form id="login" method="post" action="/login/submit"><input id="user"><input id="password" type="password"><button id="submit">Log in</button></form><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();location.href='/two_factor/';}</script>`
        : path === "/two_factor/"
          ? `<div id="totp"><input id="code"><button id="verify">Verify</button></div><script>document.querySelector('button').onclick=()=>location.href='/messages/';</script>`
          : `<a id="identity" data-account-id="123456789">Account</a><div id="pin"><input id="pin-code" type="password"><button id="restore">Restore</button></div><script>document.querySelector('button').onclick=()=>{document.querySelector('#pin').remove();const el=document.createElement('div');el.id='chats';document.body.append(el);};</script>`;
    await route.fulfill({ contentType: "text/html", body: content });
  });
  const profile = validateLoginProfile({
    version: 2,
    reviewRef: "evidence-synthetic-auto",
    reviewedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    url: `${base}/login/`,
    form: "#login",
    username: "#user",
    password: "#password",
    automation: {
      accountRef: "123456789",
      identity: { selector: "#identity", attribute: "data-account-id" },
      passwordSubmit: "#submit",
      totp: { url: `${base}/two_factor/`, marker: "#totp", input: "#code", submit: "#verify" },
      pin: { url: `${base}/messages/`, marker: "#pin", input: "#pin-code", submit: "#restore" },
      ready: { url: `${base}/messages/`, marker: "#chats" },
      checkpoint: "#checkpoint",
      rejected: "#rejected",
      loading: "#loading",
    },
  });
  const accountId = "00000000-0000-4000-8000-000000000001",
    runId = "00000000-0000-4000-8000-000000000002";
  const runtime = createAutomaticLoginRuntime({
    accountId,
    runId,
    profile,
    leaseDeadline: () => Date.now() + 60000,
    sessions: new Map([
      [accountId, { tabGroups: new Map([[runId, new Map([["tab", { page }]])]]) }],
    ]),
  });
  const packet = {
    userId: accountId,
    runId,
    tabId: "tab",
    requestId: "00000000-0000-4000-8000-000000000003",
    expiresAt: Date.now() + 30000,
  };
  await page.goto(`${base}/login/`);
  expect((await runtime("observe", { ...packet })).state).toBe("password");
  expect(
    (
      await runtime("submit", {
        ...packet,
        phase: "password",
        values: { username: "synthetic", password: "synthetic-password" },
      })
    ).outcome,
  ).toBe("submitted");
  await page.waitForURL(`${base}/two_factor/`);
  expect((await runtime("observe", { ...packet })).state).toBe("totp");
  expect((await runtime("submit", { ...packet, phase: "password", values: {} })).outcome).toBe(
    "refused",
  );
  expect(
    (
      await runtime("submit", {
        ...packet,
        phase: "totp",
        values: { code: "123456", expiresAt: packet.expiresAt },
      })
    ).outcome,
  ).toBe("submitted");
  await page.waitForURL(`${base}/messages/`);
  expect((await runtime("observe", { ...packet })).state).toBe("pin");
  expect(
    (
      await runtime("submit", {
        ...packet,
        phase: "pin",
        values: { code: "654321", expiresAt: packet.expiresAt },
      })
    ).outcome,
  ).toBe("submitted");
  expect(await runtime("observe", { ...packet })).toMatchObject({
    state: "ready",
    identityVerified: true,
    messengerRestored: true,
  });
  await page.locator("#identity").evaluate((el) => el.setAttribute("data-account-id", "999999999"));
  expect(await runtime("observe", { ...packet })).toMatchObject({ accountMismatch: true });
});
