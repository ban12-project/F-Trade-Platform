import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1280, 1440]) {
  test(`workspace content fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/testing/project-workflow?record=content",
      "/testing/project-workflow?record=product&state=product-review",
      "/testing/project-workflow?kind=sales&record=rfq",
      "/testing/video-workspace?state=review",
      "/testing/publication-batch",
    ]) {
      await page.goto(route);
      await expect(page.locator("main").first()).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        route,
      ).toBe(true);
    }
  });
}

test("video preview sticks only when it fits and releases on small screens", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/testing/video-workspace?state=review");
  const preview = page.locator(".workspace-sticky-panel");
  await expect(preview).toHaveCSS("position", "sticky");
  await page.evaluate(() => window.scrollTo(0, 300));
  const toolbar = await page.locator(".workspace-toolbar").boundingBox();
  const panel = await preview.boundingBox();
  if (!panel || !toolbar) throw new Error("Expected visible preview and toolbar");
  expect(panel.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(preview).toHaveCSS("position", "static");
  await page.setViewportSize({ width: 1440, height: 200 });
  await expect(preview).toHaveAttribute("data-sticky", "false");
});

for (const target of [
  "/workspace",
  "/workspace/settings?section=channels",
  "https://evil.invalid",
]) {
  test(`OTP completion returns safely: ${target}`, async ({ page }) => {
    await page.route("**/api/auth/sign-in/email-otp", (route) =>
      route.fulfill({
        json: { token: "synthetic", user: { id: "synthetic", email: "synthetic@example.invalid" } },
      }),
    );
    await page.route("**/workspace**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<main>synthetic signed-in destination</main>",
      }),
    );
    await page.goto(`/auth?next=${encodeURIComponent(target)}`);
    await page.getByLabel("邮箱", { exact: true }).fill("synthetic@example.invalid");
    await page.getByLabel("邮箱验证码", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "验证并登录", exact: true }).click();
    await expect(page).toHaveURL(
      `http://127.0.0.1:3000${target.startsWith("/workspace") ? target : "/workspace"}`,
    );
  });
}

test("Passkey completion returns to the requested workspace page", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.credentials, "get", {
      value: async () => ({
        id: "c3ludGhldGlj",
        rawId: new Uint8Array([1, 2, 3]).buffer,
        type: "public-key",
        response: {
          authenticatorData: new Uint8Array([1]).buffer,
          clientDataJSON: new Uint8Array([2]).buffer,
          signature: new Uint8Array([3]).buffer,
          userHandle: null,
        },
        getClientExtensionResults: () => ({}),
      }),
    });
  });
  await page.route("**/api/auth/passkey/generate-authenticate-options", (route) =>
    route.fulfill({
      json: {
        challenge: "c3ludGhldGlj",
        rpId: "127.0.0.1",
        allowCredentials: [],
        userVerification: "preferred",
      },
    }),
  );
  await page.route("**/api/auth/passkey/verify-authentication", (route) =>
    route.fulfill({ json: { session: { id: "synthetic" }, user: { id: "synthetic" } } }),
  );
  await page.route("**/workspace/settings*", (route) =>
    route.fulfill({ contentType: "text/html", body: "<main>Synthetic destination</main>" }),
  );
  await page.goto("/auth?next=%2Fworkspace%2Fsettings%3Fsection%3Daccount");
  await page.getByRole("button", { name: "使用 Passkey 登录", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3000/workspace/settings?section=account");
});

test("content editing preserves input across responsive layout changes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/testing/project-workflow?record=content");
  const hook = page.getByLabel("开场句", { exact: true });
  await hook.fill("Synthetic unsaved text");
  const columns = page.locator("form .workspace-equal-columns");
  expect(
    await columns.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
  ).toBe(2);
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(hook).toHaveValue("Synthetic unsaved text");
  expect(
    await columns.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
  ).toBe(1);
});

test("enlarged text and reduced transparency keep the toolbar readable", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce", contrast: "more" });
  await page.goto("/testing/video-workspace?state=review");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(page.getByRole("heading", { name: "视频编辑器", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await expect(page.locator(".workspace-toolbar")).toHaveCSS("backdrop-filter", "none");
});
