import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

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

  await expect(page).toHaveURL(/\/auth$/);
});

test("sends a completed sign-in to the workspace", () => {
  const authPanel = readFileSync("app/auth/panel.tsx", "utf8");
  expect(authPanel).toContain('window.location.assign("/workspace")');
});
