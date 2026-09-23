import { expect, test } from "@playwright/test";
import { createSavedLoginExecutor } from "../../ops/browser-node/login.mjs";
import { createAutomaticLoginRuntime } from "../../ops/browser-node/login-plugin/automatic-runtime.js";
import { validateLoginProfile } from "../../ops/browser-node/login-plugin/index.js";

for (const mode of [
  "page-contract",
  "executor",
  "formaction",
  "formmethod",
  "formtarget",
] as const) {
  test(`automatic login contract: ${mode}`, async ({
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
    const profile = {
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
    };
    validateLoginProfile(profile);
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
    if (mode === "executor") {
      const calls: string[] = [];
      const run = {
        kind: "interactive",
        id: runId,
        accountId,
        leaseId: "00000000-0000-4000-8000-000000000004",
      };
      const execute = createSavedLoginExecutor({
        run,
        profile,
        assertActive() {},
        async checkEgress() {},
        async request(operation, body) {
          calls.push(operation);
          if (operation === "claim-login")
            return {
              authorizationId: packet.requestId,
              expiresAt: packet.expiresAt,
              serverNow: Date.now(),
              roundTripMs: 0,
              credential: {
                username: "synthetic",
                password: "synthetic-password",
                totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
                messengerPin: "654321",
              },
            };
          expect(operation).toBe("login-result");
          calls.push(`result:${body.outcome}`);
          return {};
        },
        async browserRequest(path, body) {
          if (path === "/ftrade/login-status")
            return Response.json({
              version: 2,
              runId,
              accountId,
              reviewRef: profile.reviewRef,
              expiresAt: Date.parse(profile.expiresAt),
            });
          if (path === "/tabs") {
            await page.goto(profile.url);
            return Response.json({ tabId: "tab", url: page.url() });
          }
          if (!body) throw new Error("missing_browser_packet");
          if (path === "/ftrade/login-submit") calls.push(`submit:${body.phase}`);
          const observed = await runtime(
            path === "/ftrade/login-observe" ? "observe" : "submit",
            body,
          );
          return Response.json(observed);
        },
      });
      const outcome = await execute({ id: packet.requestId, expiresAt: packet.expiresAt });
      expect(outcome, JSON.stringify(calls)).toBe("ready");
      expect(calls).toEqual([
        "claim-login",
        "submit:password",
        "submit:totp",
        "submit:pin",
        "login-result",
        "result:ready",
      ]);
      expect(await execute({ id: packet.requestId, expiresAt: packet.expiresAt })).toBe("refused");
    } else {
      await page.goto(`${base}/login/`);
      if (["formaction", "formmethod", "formtarget"].includes(mode)) {
        await page.locator("#submit").evaluate((button, attribute) => {
          button.setAttribute(
            attribute,
            attribute === "formaction"
              ? "https://synthetic-invalid.example/login/"
              : attribute === "formmethod"
                ? "get"
                : "_blank",
          );
        }, mode);
        expect(
          (
            await runtime("submit", {
              ...packet,
              phase: "password",
              values: { username: "synthetic", password: "synthetic-password" },
            })
          ).outcome,
        ).toBe("refused");
        await expect(page.locator("#user")).toHaveValue("");
        await expect(page.locator("#password")).toHaveValue("");
        return;
      }

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
    }
    expect(await runtime("observe", { ...packet })).toMatchObject({
      state: "ready",
      identityVerified: true,
      messengerRestored: true,
    });
    await page
      .locator("#identity")
      .evaluate((el) => el.setAttribute("data-account-id", "999999999"));
    expect(await runtime("observe", { ...packet })).toMatchObject({ accountMismatch: true });
  });
}
