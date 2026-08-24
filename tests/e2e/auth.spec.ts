import { expect, test } from "@playwright/test";

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
