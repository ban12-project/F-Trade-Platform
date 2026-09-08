import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createLoginFill,
  register,
  validateLoginProfile,
} from "../../ops/browser-node/login-plugin/index.js";

const profile = {
  version: 1,
  reviewRef: "evidence-synthetic-login",
  reviewedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  url: "https://www.facebook.com/login/",
  form: "#login",
  username: "#username",
  password: "#password",
};
for (const mode of [
  "normal",
  "wrong_origin",
  "wrong_action",
  "wrong_field",
  "duplicate_field",
  "prefilled_password",
  "wrong_account",
  "wrong_run",
  "expired",
  "expired_lease",
  "expired_in_page",
  "lost_response",
  "browser_error",
  "concurrent",
] as const) {
  test(`isolated login fill ${mode}`, async ({ page, context }) => {
    const accountId = randomUUID(),
      runId = randomUUID();
    let submitted = 0,
      evaluations = 0;
    const username = "SYNTHETIC@example.invalid",
      password = "  SYNTHETIC-secret-测试  ";
    await context.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<form id="login" method="post" action="${mode === "wrong_action" ? "https://evil.invalid/login/" : "https://www.facebook.com/login/device-based/regular/login/"}"><input id="username" type="text"><input id="password" type="${mode === "wrong_field" ? "text" : "password"}" value="${mode === "prefilled_password" ? "SYNTHETIC existing" : ""}">${mode === "duplicate_field" ? '<input id="password" type="password">' : ""}<button>Log in</button></form>`,
      }),
    );
    await page.goto(mode === "wrong_origin" ? "https://evil.invalid/login/" : profile.url);
    await page.exposeFunction("syntheticSubmit", () => {
      submitted++;
    });
    await page.locator("form").evaluate((form) =>
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        (window as unknown as { syntheticSubmit(): void }).syntheticSubmit();
      }),
    );
    const controlledPage = {
      isClosed: () => page.isClosed(),
      async evaluate(program: Parameters<typeof page.evaluate>[0], payload: unknown) {
        evaluations++;
        if (mode === "browser_error") throw new Error(`SYNTHETIC upstream exception ${password}`);
        if (mode === "expired_in_page")
          (payload as { expiresAt: number }).expiresAt = Date.now() - 1;
        const result = await page.evaluate(program, payload);
        if (mode === "lost_response") throw new Error(`SYNTHETIC lost response ${username}`);
        return result;
      },
    };
    const sessions = new Map([
      [accountId, { tabGroups: new Map([[runId, new Map([["tab", { page: controlledPage }]])]]) }],
    ]);
    const fill = createLoginFill({
      sessions,
      accountId,
      runId,
      kind: "interactive",
      profile,
      leaseDeadline: () => Date.now() + (mode === "expired_lease" ? -1 : 60000),
    });
    const packet = () => ({
      requestId: randomUUID(),
      runId: mode === "wrong_run" ? randomUUID() : runId,
      userId: mode === "wrong_account" ? randomUUID() : accountId,
      tabId: "tab",
      username,
      password,
      expiresAt: Date.now() + (mode === "expired" ? -1 : 20000),
    });
    const first = packet();
    const results =
      mode === "concurrent"
        ? await Promise.all([fill(first), fill(packet())])
        : [await fill(first)];
    const expected = ["normal", "concurrent"].includes(mode)
      ? "filled"
      : ["lost_response", "browser_error"].includes(mode)
        ? "unknown"
        : "refused";
    expect(results[0]).toEqual({ outcome: expected });
    if (mode === "concurrent") expect(results[1]).toEqual({ outcome: "refused" });
    expect(first).not.toHaveProperty("username");
    expect(first).not.toHaveProperty("password");
    expect(JSON.stringify(results)).not.toContain(username);
    expect(JSON.stringify(results)).not.toContain(password);
    expect(submitted).toBe(0);
    if (["normal", "lost_response", "concurrent"].includes(mode)) {
      expect(await page.locator("#username").inputValue()).toBe(username);
      expect(await page.locator("#password").inputValue()).toBe(password);
    }
    const before = evaluations;
    const replay = await fill(packet());
    expect(replay.outcome).toBe("refused");
    expect(evaluations).toBe(before);
    expect(evaluations).toBe(
      ["wrong_account", "wrong_run", "expired", "expired_lease"].includes(mode) ? 0 : 1,
    );
  });
}
test("login plugin is disabled by default and rejects missing runtime authority", () => {
  let routes = 0;
  register(
    {
      post() {
        routes++;
      },
    },
    {},
    {},
  );
  expect(routes).toBe(0);
  expect(() => register({}, {}, { enabled: true })).toThrow("login_access_key_required");
  expect(() =>
    createLoginFill({
      sessions: new Map(),
      accountId: randomUUID(),
      runId: randomUUID(),
      kind: "inbox",
      profile,
      leaseDeadline: () => Date.now() + 60000,
    }),
  ).toThrow("login_runtime_scope_invalid");
  expect(() => validateLoginProfile({ ...profile, url: "https://evil.invalid/login/" })).toThrow(
    "login_profile_invalid",
  );
  expect(() => validateLoginProfile({ ...profile, expiresAt: new Date(0).toISOString() })).toThrow(
    "login_profile_invalid",
  );
});
