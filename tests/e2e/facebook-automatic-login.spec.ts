import { expect, test } from "@playwright/test";
import { createSavedLoginExecutor } from "../../ops/browser-node/login.mjs";
import { createAutomaticLoginRuntime } from "../../ops/browser-node/login-plugin/automatic-runtime.js";
import { validateLoginProfile } from "../../ops/browser-node/login-plugin/index.js";

for (const mode of [
  "page-contract",
  "executor",
  "executor-ready",
  "executor-observe-only-ready",
  "executor-observe-only-recovery",
  "executor-checkpoint-ready",
  "executor-checkpoint",
  "lease-bound",
  "formaction",
  "formmethod",
  "formtarget",
  "bootstrap",
  "bootstrap-cookie-mismatch",
  "bootstrap-data-mismatch",
  "bootstrap-switched",
  "bootstrap-no-cookie",
  "ready-shell",
  "aria-submit",
  "aria-disabled",
  "aria-outside",
  "authenticator",
  "authenticator-stuck",
  "authenticator-wrong-flow",
  "authenticator-transition",
  "authenticator-captcha",
] as const) {
  test(`automatic login contract: ${mode}`, async ({ page }) => {
    const base = "https://www.facebook.com";
    let humanApproved = false;
    await page.route(`${base}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      let content =
        path === "/login/"
          ? `<form id="login" method="post" action="/login/submit"><input id="user"><input id="password" type="password"><button id="submit">Log in</button></form><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();location.href='/two_factor/';}</script>`
          : path === "/two_factor/"
            ? `<div id="totp"><input id="code"><button id="verify">Verify</button></div><script>document.querySelector('button').onclick=()=>location.href='/messages/';</script>`
            : `<a id="identity" data-account-id="123456789">Account</a><div id="pin"><input id="pin-code" type="password"><button id="restore">Restore</button></div><script>document.querySelector('button').onclick=()=>{document.querySelector('#pin').remove();const el=document.createElement('div');el.id='chats';el.innerHTML='<span id="empty">No chats</span>';document.body.append(el);};</script>`;
      if (
        mode === "executor-ready" ||
        mode === "executor-observe-only-ready" ||
        mode === "executor-checkpoint-ready"
      )
        content =
          '<a id="identity" data-account-id="123456789">Account</a><div id="chats"><span id="empty">No chats</span></div>';
      if (path === "/login/" && mode.startsWith("aria-")) {
        const button = `<div id="submit" role="button" tabindex="0" ${mode === "aria-disabled" ? 'aria-disabled="true"' : ""} onclick="location.href='/two_factor/'">Log in</div>`;
        content = content.replace(
          '<button id="submit">Log in</button>',
          mode === "aria-outside" ? "" : button,
        );
        if (mode === "aria-outside") content += button;
      }
      if (mode === "executor-checkpoint-ready" && !humanApproved)
        content = '<div id="checkpoint">Synthetic device approval required</div>';
      if (path === "/two_factor/" && mode === "executor-checkpoint" && !humanApproved)
        content = '<div id="checkpoint">Synthetic device approval required</div>';
      if (path === "/two_step_verification/two_factor/")
        content = `<h2>Go to your authentication app</h2><form><input id="code" type="text" autocomplete="off"></form><div role="button" tabindex="-1" aria-disabled="true">Continue</div><div role="button" tabindex="0">Try another way</div><script>document.querySelector('input').oninput=()=>{${mode === "authenticator-stuck" ? "" : "setTimeout(()=>{const b=document.querySelector('[role=button]');b.removeAttribute('aria-disabled');b.tabIndex=0;},100);"}};document.querySelector('[role=button]').onclick=()=>location.href='/messages/';</script>`;
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
        ready: {
          url: `${base}/messages/`,
          marker: "#chats",
          empty: "span",
          emptyText: "No chats",
          thread: "a[data-thread-id]",
        },
        checkpoint: "#checkpoint",
        rejected: "#rejected",
        loading: "#loading",
      },
    };
    if (mode.startsWith("executor-observe-only"))
      Object.assign(profile.automation, { mode: "observe-only" });
    if (mode.startsWith("bootstrap"))
      profile.automation.identity = {
        selector: 'script[type="application/json"]',
        attribute: "facebook-current-user",
      };
    if (mode.startsWith("authenticator"))
      Object.assign(profile.automation.totp, {
        mode: "facebook-authenticator",
        url: `${base}/two_step_verification/two_factor/`,
        marker: "h2",
        input: "#code",
        submit: '[role="button"]',
      });
    if (mode === "lease-bound") profile.expiresAt = new Date(Date.now() + 180000).toISOString();
    validateLoginProfile(profile);
    const accountId = "00000000-0000-4000-8000-000000000001",
      runId = "00000000-0000-4000-8000-000000000002";
    let leaseUntil = Date.now() + 60000;
    const runtime = createAutomaticLoginRuntime({
      accountId,
      runId,
      profile,
      leaseDeadline: () => leaseUntil,
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
    if (mode === "lease-bound") {
      await page.goto(`${base}/messages/`);
      packet.expiresAt = Date.now() + 170000;
      expect(await runtime("observe", { ...packet, expiresAt: Date.now() + 181000 })).toMatchObject(
        { outcome: "refused" },
      );
      leaseUntil = Date.now() - 1;
      expect(await runtime("observe", { ...packet })).toMatchObject({ outcome: "refused" });
      leaseUntil = Date.now() + 60000;
      expect(
        await runtime("submit", {
          ...packet,
          phase: "pin",
          values: { code: "123456", expiresAt: packet.expiresAt },
        }),
      ).toMatchObject({ outcome: "submitted" });
      expect(await runtime("observe", { ...packet })).toMatchObject({ state: "ready" });
      leaseUntil = Date.now() - 1;
      expect(await runtime("observe", { ...packet })).toMatchObject({ outcome: "refused" });
      return;
    }
    if (mode.startsWith("authenticator")) {
      if (mode === "authenticator-captcha") {
        await page.route("https://www.fbsbx.com/captcha/recaptcha/iframe/**", (route) =>
          route.fulfill({ contentType: "text/html", body: "Synthetic human verification" }),
        );
        await page.route(`${base}/common/referer_frame.php`, (route) =>
          route.fulfill({
            contentType: "text/html",
            body: '<iframe src="https://www.fbsbx.com/captcha/recaptcha/iframe/"></iframe>',
          }),
        );
        await page.goto(
          `${base}/two_step_verification/authentication/?encrypted_context=synthetic&flow=pre_authentication&next`,
        );
        await page.setContent(
          `<iframe id="outer" src="${base}/common/referer_frame.php"></iframe>`,
        );
        await expect(page.frameLocator("#outer").frameLocator("iframe").locator("body")).toHaveText(
          "Synthetic human verification",
        );
        expect(await runtime("observe", { ...packet })).toMatchObject({
          state: "checkpoint",
          messengerRestored: false,
        });
        await page.locator("#outer").evaluate((el) => {
          el.style.display = "none";
        });
        expect(await runtime("observe", { ...packet })).toMatchObject({ state: "loading" });
        await page.locator("#outer").evaluate((el) => {
          el.style.display = "block";
        });
        expect(
          await runtime("submit", {
            ...packet,
            phase: "totp",
            values: { code: "123456", expiresAt: packet.expiresAt },
          }),
        ).toMatchObject({ outcome: "refused" });
        return;
      }
      if (mode === "authenticator-transition") {
        await page.goto(
          `${base}/two_step_verification/authentication/?encrypted_context=synthetic&flow=pre_authentication&next`,
        );
        await page.setContent('<img alt="Meta"><iframe></iframe>');
        expect(await runtime("observe", { ...packet })).toMatchObject({
          state: "loading",
          identityVerified: false,
          messengerRestored: false,
        });
        expect(
          await runtime("submit", {
            ...packet,
            phase: "totp",
            values: { code: "123456", expiresAt: packet.expiresAt },
          }),
        ).toMatchObject({ outcome: "refused" });
        await page.goto(
          `${base}/two_step_verification/two_factor/?encrypted_context=synthetic&flow=two_factor_login&next`,
        );
        await page.setContent('<img alt="Meta">');
        expect(await runtime("observe", { ...packet })).toMatchObject({ state: "loading" });
        await page.goto(
          `${base}/two_step_verification/authentication/?encrypted_context=synthetic&flow=wrong&next`,
        );
        await page.setContent('<img alt="Meta"><iframe></iframe>');
        expect(await runtime("observe", { ...packet })).toMatchObject({ state: "invalid" });
        return;
      }
      await page.goto(
        `${base}/two_step_verification/two_factor/?encrypted_context=synthetic&flow=${mode === "authenticator-wrong-flow" ? "wrong" : "two_factor_login"}&next`,
      );
      if (mode === "authenticator")
        await page.evaluate(() => {
          Object.defineProperty(URLSearchParams.prototype, "keys", { value: () => ({}) });
        });
      const observed = await runtime("observe", { ...packet });
      expect(observed.state === "totp").toBe(mode !== "authenticator-wrong-flow");
      const submitted = await runtime("submit", {
        ...packet,
        phase: "totp",
        values: { code: "123456", expiresAt: packet.expiresAt },
      });
      expect(submitted.outcome).toBe(
        mode === "authenticator"
          ? "submitted"
          : mode === "authenticator-stuck"
            ? "unknown"
            : "refused",
      );
      expect(
        (
          await runtime("submit", {
            ...packet,
            phase: "totp",
            values: { code: "123456", expiresAt: packet.expiresAt },
          })
        ).outcome,
      ).toBe("refused");
      if (mode === "authenticator") await expect(page).toHaveURL(`${base}/messages/`);
      if (mode === "authenticator-wrong-flow") await expect(page.locator("#code")).toHaveValue("");
      return;
    }
    if (mode === "ready-shell") {
      await page.goto(`${base}/messages/`);
      await page.locator("#pin").evaluate((el) => el.remove());
      await page.evaluate(() => {
        const root = document.createElement("nav");
        root.id = "chats";
        root.innerHTML = "<h1>Chats</h1><span>Other interface label</span>";
        document.body.append(root);
      });
      expect(await runtime("observe", { ...packet })).toMatchObject({
        state: "loading",
        messengerRestored: false,
      });
      await page.locator("#chats").evaluate((el) => {
        el.innerHTML += '<span id="empty">Loading</span>';
      });
      expect(await runtime("observe", { ...packet })).toMatchObject({
        state: "loading",
        messengerRestored: false,
      });
      await page.locator("#empty").evaluate((el) => {
        el.textContent = "No chats";
      });
      expect(await runtime("observe", { ...packet })).toMatchObject({
        state: "ready",
        messengerRestored: true,
      });
      await page.evaluate(() => {
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.textContent = "Restore chats";
        document.body.append(dialog);
      });
      expect(await runtime("observe", { ...packet })).toMatchObject({
        state: "loading",
        messengerRestored: false,
      });
      await page.locator('[role="dialog"]').evaluate((el) => el.remove());
      await page.locator("#chats").evaluate((el) => {
        el.innerHTML += '<a data-thread-id="synthetic-thread">Conversation</a>';
      });
      expect(await runtime("observe", { ...packet })).toMatchObject({
        state: "loading",
        messengerRestored: false,
      });
      await page.locator("#empty").evaluate((el) => el.remove());
      expect(await runtime("observe", { ...packet })).toMatchObject({
        state: "ready",
        messengerRestored: true,
      });
      return;
    }
    if (mode.startsWith("bootstrap")) {
      if (mode !== "bootstrap-no-cookie")
        await page.context().addCookies([
          {
            name: "c_user",
            value: mode === "bootstrap-cookie-mismatch" ? "999999999" : "123456789",
            url: base,
          },
          ...(mode === "bootstrap-switched"
            ? [{ name: "i_user", value: "999999999", url: base }]
            : []),
        ]);
      await page.goto(`${base}/messages/`);
      await page.evaluate((wrong) => {
        const script = document.createElement("script");
        script.type = "application/json";
        script.textContent = JSON.stringify({
          require: [
            [
              "CurrentUserInitialData",
              [],
              {
                USER_ID: wrong ? "999999999" : "123456789",
                ACCOUNT_ID: "123456789",
              },
              1,
            ],
          ],
        });
        document.head.append(script);
      }, mode === "bootstrap-data-mismatch");
      const observed = await runtime("observe", { ...packet });
      expect(observed.identityVerified === true).toBe(mode === "bootstrap");
      expect(
        (
          await runtime("submit", {
            ...packet,
            phase: "pin",
            values: { code: "654321", expiresAt: packet.expiresAt },
          })
        ).outcome,
      ).toBe(mode === "bootstrap" ? "submitted" : "refused");
      if (mode === "bootstrap")
        expect(await runtime("observe", { ...packet })).toMatchObject({
          state: "ready",
          identityVerified: true,
          messengerRestored: true,
        });
      else await expect(page.locator("#pin-code")).toHaveValue("");
      return;
    }
    if (mode.startsWith("executor")) {
      profile.expiresAt = new Date(Date.now() + 180000).toISOString();
      packet.expiresAt = Date.now() + 170000;
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
          if (operation === "login-challenge") {
            expect(body.challenge).toBe("checkpoint");
            expect(body.authorizationId).toBe(packet.requestId);
            humanApproved = true;
            await page.goto(
              mode === "executor-checkpoint-ready" ? `${base}/messages/` : `${base}/two_factor/`,
            );
            return { recorded: true };
          }
          expect(operation).toBe("login-result");
          expect(body.challenge).toBeUndefined();
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
            if (mode.startsWith("executor-observe-only"))
              expect(body?.url).toBe(profile.automation.ready.url);
            await page.goto(
              [
                "executor-ready",
                "executor-observe-only-ready",
                "executor-checkpoint-ready",
              ].includes(mode)
                ? `${base}/messages/`
                : mode === "executor-observe-only-recovery"
                  ? profile.automation.ready.url
                  : profile.url,
            );
            return Response.json({ tabId: "tab", url: page.url() });
          }
          if (!body) throw new Error("missing_browser_packet");
          // The executor must not truncate an automatic grant to the 90-second lease window.
          // The runtime still separately checks the current, shorter lease on every operation.
          expect(body.expiresAt).toBeGreaterThan(Date.now() + 90000);
          expect(body.expiresAt).toBeLessThan(packet.expiresAt);
          if (path === "/ftrade/login-submit") calls.push(`submit:${body.phase}`);
          const observed = await runtime(
            path === "/ftrade/login-observe" ? "observe" : "submit",
            body,
          );
          return Response.json(observed);
        },
      });
      const outcome = await execute({ id: packet.requestId, expiresAt: packet.expiresAt });
      expect(outcome, JSON.stringify(calls)).toBe(
        mode === "executor-observe-only-recovery" ? "refused" : "ready",
      );
      expect(calls).toEqual(
        mode === "executor-observe-only-recovery"
          ? ["login-result", "result:refused"]
          : mode === "executor-checkpoint-ready"
            ? ["login-challenge", "login-result", "result:ready"]
            : mode === "executor-ready" || mode === "executor-observe-only-ready"
              ? ["login-result", "result:ready"]
              : mode === "executor-checkpoint"
                ? [
                    "claim-login",
                    "submit:password",
                    "login-challenge",
                    "submit:totp",
                    "submit:pin",
                    "login-result",
                    "result:ready",
                  ]
                : [
                    "claim-login",
                    "submit:password",
                    "submit:totp",
                    "submit:pin",
                    "login-result",
                    "result:ready",
                  ],
      );
      if (mode === "executor-observe-only-recovery") {
        for (const [phase, values] of [
          ["password", { username: "synthetic", password: "synthetic-password" }],
          ["totp", { code: "123456", expiresAt: packet.expiresAt }],
          ["pin", { code: "654321", expiresAt: packet.expiresAt }],
        ] as const)
          expect((await runtime("submit", { ...packet, phase, values })).outcome).toBe("refused");
        await expect(page.locator("#pin-code")).toHaveValue("");
      }
      expect(await execute({ id: packet.requestId, expiresAt: packet.expiresAt })).toBe("refused");
      if (mode === "executor-observe-only-recovery") return;
    } else {
      await page.goto(`${base}/login/`);
      if (["aria-disabled", "aria-outside"].includes(mode)) {
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
