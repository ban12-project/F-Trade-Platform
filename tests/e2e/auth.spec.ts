import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { workspaceSignInHref, workspaceSignInTarget } from "../../lib/auth-navigation";
import { proxy } from "../../proxy";

import { parseAdminSeedArgs } from "../../scripts/seed-admins";

test("requires explicit confirmation and supports multiple administrator emails", () => {
  expect(
    parseAdminSeedArgs([
      "node",
      "scripts/seed-admins.ts",
      "--emails",
      "Admin@example.com,second@example.com,admin@example.com",
      "--confirm",
    ]),
  ).toEqual({
    emails: ["admin@example.com", "second@example.com"],
    confirm: true,
  });
  expect(() => parseAdminSeedArgs(["node", "scripts/seed-admins.ts"])).toThrow("--emails");
});

test("rejects public email and password sign-up", async ({ request }) => {
  const response = await request.post("/api/auth/sign-up/email", {
    data: {
      email: "synthetic@example.invalid",
      name: "Synthetic User",
      password: "synthetic-password",
    },
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
  });
});

test("redirects an unauthenticated workspace request to sign-in", async ({ page }) => {
  await page.goto("/workspace");

  await expect(page).toHaveURL(/\/auth\?next=%2Fworkspace$/);
});

test("preserves workspace paths and rejects unsafe return destinations", () => {
  for (const target of [
    "/workspace",
    "/workspace/products?project=synthetic&type=product",
    "/workspace/settings?section=channels&returnTo=%2Fworkspace%2Fcontent",
  ]) {
    expect(workspaceSignInTarget(target)).toBe(target);
    expect(
      new URL(workspaceSignInHref(target), "https://test.invalid").searchParams.get("next"),
    ).toBe(target);
  }
  for (const target of [
    null,
    "",
    "https://evil.invalid/workspace",
    "//evil.invalid",
    "/auth",
    "/workspace-other",
    "/workspace/../../auth",
    "/workspace/%2e%2e/auth",
    "/workspace/%5cevil",
    "/workspace/%00",
    "/workspace/%zz",
  ]) {
    expect(workspaceSignInTarget(target)).toBe("/workspace");
  }
});

test("retains a deep link and its query when requesting sign-in", async ({ page }) => {
  const target = "/workspace/settings?section=channels&returnTo=%2Fworkspace%2Fcontent";
  await page.goto(target);
  expect(new URL(page.url()).searchParams.get("next")).toBe(target);
  await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
});

test("landing page has one workspace action", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "进入工作台" })).toHaveAttribute(
    "href",
    "/workspace",
  );
  await expect(page.getByRole("link", { name: "查看工作台" })).toHaveCount(0);
});

test("proxy replaces a supplied return header with the actual request path", async () => {
  const response = await proxy(
    new NextRequest("https://test.invalid/workspace/settings?section=account", {
      headers: {
        cookie: "better-auth.session_token=synthetic-stale-cookie",
        "x-workspace-return-path": "https://evil.invalid",
      },
    }),
  );
  expect(response.headers.get("x-middleware-request-x-workspace-return-path")).toBe(
    "/workspace/settings?section=account",
  );
});
