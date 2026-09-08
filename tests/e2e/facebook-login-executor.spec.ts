import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createSavedLoginExecutor } from "../../ops/browser-node/login.mjs";
import { createLoginFill } from "../../ops/browser-node/login-plugin/index.js";

const profile = {
  version: 1,
  reviewRef: "evidence-synthetic-login-executor",
  reviewedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  url: "https://www.facebook.com/login/",
  form: "#login",
  username: "#username",
  password: "#password",
};
for (const mode of [
  "normal",
  "missing_plugin",
  "wrong_runtime",
  "egress_before",
  "egress_after",
  "navigation",
  "expired_release",
  "lost_claim",
  "lost_fill",
  "lost_result",
  "disconnected",
  "concurrent",
] as const) {
  test(`saved login executor ${mode}`, async ({ page, context }) => {
    const run = {
      kind: "interactive",
      id: randomUUID(),
      leaseId: randomUUID(),
      accountId: randomUUID(),
    };
    const notice = { id: randomUUID(), expiresAt: Date.now() + 60000 };
    const sessions = new Map<string, { tabGroups: Map<string, Map<string, { page: unknown }>> }>();
    const fill = createLoginFill({
      sessions,
      accountId: run.accountId,
      runId: run.id,
      kind: run.kind,
      profile,
      leaseDeadline: () => Date.now() + 60000,
    });
    const refusal = [
      "missing_plugin",
      "wrong_runtime",
      "egress_before",
      "egress_after",
      "navigation",
    ].includes(mode);
    const calls: string[] = [];
    let checks = 0,
      active = true;
    const releases: Array<Record<string, unknown>> = [];
    await context.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<form id="login" method="post" action="https://www.facebook.com/login/"><input id="username"><input id="password" type="password"><button>Login</button></form>',
      }),
    );
    const execute = createSavedLoginExecutor({
      run,
      profile,
      assertActive() {
        if (!active) throw new Error("synthetic_disconnected");
      },
      async checkEgress() {
        calls.push("egress");
        checks++;
        if ((mode === "egress_before" && checks === 1) || (mode === "egress_after" && checks === 2))
          throw new Error("synthetic_bad_egress");
      },
      async browserRequest(path, body) {
        calls.push(path);
        if (path === "/ftrade/login-status")
          return mode === "missing_plugin"
            ? Response.json({}, { status: 404 })
            : Response.json({
                version: 1,
                runId: mode === "wrong_runtime" ? randomUUID() : run.id,
                accountId: run.accountId,
                reviewRef: profile.reviewRef,
                expiresAt: Date.parse(profile.expiresAt),
              });
        if (path === "/tabs") {
          expect(body).toEqual({
            userId: run.accountId,
            sessionKey: run.id,
            url: profile.url,
            trace: false,
          });
          await page.goto(profile.url);
          sessions.set(run.accountId, {
            tabGroups: new Map([[run.id, new Map([["tab", { page }]])]]),
          });
          return Response.json({
            tabId: "tab",
            url: mode === "navigation" ? "https://www.facebook.com/other" : page.url(),
          });
        }
        expect(path).toBe("/ftrade/login-fill");
        expect(body).toBeDefined();
        const result = await fill(body ?? {});
        if (mode === "lost_fill") throw new Error("SYNTHETIC secret in upstream error");
        return Response.json(result);
      },
      async request(operation, fields) {
        calls.push(operation);
        expect(fields.authorizationId).toBe(notice.id);
        if (operation === "claim-login") {
          if (mode === "lost_claim") throw new Error("SYNTHETIC credential response lost");
          const result = {
            credential: {
              username: "SYNTHETIC@example.invalid",
              password: "  SYNTHETIC exact password  ",
            },
            authorizationId: notice.id,
            expiresAt: Date.now() + (mode === "expired_release" ? 1000 : 30000),
            serverNow: Date.now(),
            roundTripMs: 1,
          };
          releases.push(result);
          if (mode === "disconnected") active = false;
          return result;
        }
        expect(operation).toBe("login-result");
        expect(fields).not.toHaveProperty("credential");
        expect(fields.outcome).toBe(
          ["normal", "concurrent", "lost_result"].includes(mode)
            ? "filled"
            : refusal
              ? "refused"
              : "unknown",
        );
        if (mode === "lost_result") throw new Error("SYNTHETIC result lost");
        return { recorded: true, replayed: false };
      },
    });
    const outcomes =
      mode === "concurrent"
        ? await Promise.all([execute(notice), execute(notice)])
        : [await execute(notice)];
    expect(outcomes[0]).toBe(
      ["normal", "concurrent"].includes(mode) ? "filled" : refusal ? "refused" : "unknown",
    );
    if (mode === "concurrent") expect(outcomes[1]).toBe("refused");
    expect(calls.filter((call) => call === "claim-login")).toHaveLength(refusal ? 0 : 1);
    if (mode === "normal")
      expect(calls).toEqual([
        "/ftrade/login-status",
        "egress",
        "/tabs",
        "egress",
        "claim-login",
        "/ftrade/login-fill",
        "login-result",
      ]);
    for (const release of releases) expect(release).not.toHaveProperty("credential");
    expect(JSON.stringify(run)).not.toContain("password");
    const before = calls.length;
    expect(await execute(notice)).toBe("refused");
    expect(calls).toHaveLength(before);
    if (["normal", "concurrent", "lost_fill", "lost_result"].includes(mode))
      expect(await page.locator("#password").inputValue()).toBe("  SYNTHETIC exact password  ");
  });
}
