import { expect, test } from "@playwright/test";

import { parseAdminSeedArgs } from "../../scripts/seed-admins";

test("requires explicit confirmation and supports multiple administrator emails", () => {
  expect(parseAdminSeedArgs([
    "node",
    "scripts/seed-admins.ts",
    "--emails",
    "Admin@example.com,second@example.com,admin@example.com",
    "--confirm",
  ])).toEqual({
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

test("redirects an unauthenticated console request to sign-in", async ({ page }) => {
  await page.goto("/console");

  await expect(page).toHaveURL(/\/auth$/);
});

test("navigates to the console after email OTP sign-in succeeds", async ({ page }) => {
  await page.route("**/api/auth/sign-in/email-otp", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        token: "synthetic-session-token",
        user: { id: "synthetic-admin", email: "admin@example.com", role: "admin" },
      }),
    });
  });
  await page.route("**/console", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<main><h1>Console landing</h1></main>",
    });
  });

  await page.goto("/auth");
  await page.getByRole("textbox", { name: "邮箱", exact: true }).fill("admin@example.com");
  await page.getByRole("textbox", { name: "邮箱验证码", exact: true }).fill("123456");
  await page.getByRole("button", { name: "验证并登录" }).click();

  await expect(page).toHaveURL(/\/console$/);
  await expect(page.getByRole("heading", { name: "Console landing" })).toBeVisible();
});
