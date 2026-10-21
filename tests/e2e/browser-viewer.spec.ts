import { expect, test } from "@playwright/test";

test("a frame without its first ready message receives its ticket on load", async ({ page }) => {
  await page.route("http://127.0.0.1:9427/viewer", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<body>Isolated remote desktop<input aria-label="Remote keyboard"><script>
      let admissions = 0;
      window.addEventListener('message', e => {
        if (e.source !== parent || e.origin !== location.ancestorOrigins[0]) return;
        if (e.data.type === 'ftrade-browser-ticket' && !admissions++) {
          document.body.dataset.admissions = admissions;
          parent.postMessage({type:'ftrade-browser-status',phase:'connected'}, e.origin);
        }
      });
      // Deliberately no initial ready notification.
    </script>`,
    }),
  );
  await page.goto("/testing/browser-viewer");
  await expect(page.getByRole("status")).toHaveText("远程桌面已连接。");
  const frame = page.frameLocator('iframe[title="账号登录与两步验证"]');
  await expect(frame.locator("body")).toHaveAttribute("data-admissions", "1");
  await frame.getByRole("textbox", { name: "Remote keyboard" }).fill("Isolated keyboard input");
  await expect(frame.getByRole("textbox")).toHaveValue("Isolated keyboard input");
});

test("a stalled iframe reports a bounded failure without another ticket or reload", async ({
  page,
}) => {
  let loads = 0;
  await page.clock.install();
  await page.route("http://127.0.0.1:9427/viewer", (route) => {
    loads++;
    return route.fulfill({ contentType: "text/html", body: "<body>Unresponsive fixture</body>" });
  });
  await page.goto("/testing/browser-viewer");
  await expect(page.frameLocator("iframe").locator("body")).toHaveText("Unresponsive fixture");
  await page.clock.fastForward(35_001);
  await expect(page.getByRole("status")).toContainText("尚未确认远程连接");
  expect(loads).toBe(1);
});

test("messages from a sibling frame cannot report a connected desktop", async ({ page }) => {
  await page.route("http://127.0.0.1:9427/viewer", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<body>Unresponsive fixture</body>",
    }),
  );
  await page.goto("/testing/browser-viewer");
  await page.evaluate(() =>
    window.postMessage({ type: "ftrade-browser-status", phase: "connected" }, "*"),
  );
  await expect(page.getByRole("status")).not.toHaveText("远程桌面已连接。");
});
