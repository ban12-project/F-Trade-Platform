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

test("an independent viewer admits once in its owning window and closes without a reload", async ({
  page,
  context,
}) => {
  let loads = 0;
  // The remote document must be the first popup navigation. A slow or blocked
  // platform receiver cannot delay the one-use ticket handshake.
  await context.route("**/testing/browser-viewer/window*", (route) => route.abort());
  const navigations: string[] = [];
  context.on("request", (request) => {
    if (request.isNavigationRequest()) navigations.push(request.url());
  });
  await context.route("http://127.0.0.1:9427/viewer", (route) => {
    loads++;
    return route.fulfill({
      contentType: "text/html",
      headers: { "Content-Security-Policy": "sandbox allow-scripts allow-same-origin" },
      body: `<body>Isolated desktop<script>
      let admitted=false;
      addEventListener('message',e=>{
        if(parent!==window) return;
        if(e.data.nonce!==location.hash.slice(1))return;
        if(e.data.type==='ftrade-browser-probe') {
          e.source.postMessage({type:'ftrade-browser-ready',nonce:e.data.nonce},e.origin);return;
        }
        if(e.data.type!=='ftrade-browser-ticket'||admitted)return;
        admitted=true;document.body.dataset.admissions='1';
      });
    </script>`,
    });
  });
  await page.clock.install();
  await page.goto("/testing/browser-viewer");
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open independent viewer" }).click();
  const popup = await opened;
  await expect(popup.locator("body")).toHaveAttribute("data-admissions", "1");
  await expect(popup.locator("iframe")).toHaveCount(0);
  await expect(popup).toHaveURL(/^http:\/\/127\.0\.0\.1:9427\/viewer#/);
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  expect(popup.url()).not.toContain("isolated-viewer-fixture");
  expect(
    await popup.evaluate(() =>
      Object.values(localStorage).some((value) => value.includes("isolated-viewer-fixture")),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Refresh fixture" }).click();
  await expect(page.getByText("Fixture version: 1")).toBeVisible();
  await page.clock.fastForward(30_001);
  expect(popup.isClosed()).toBe(false);
  await popup.close();
  await expect(page.getByText("Independent viewer closed")).toBeVisible();
  expect(loads).toBe(2);
  expect(navigations.filter((url) => !url.endsWith("/testing/browser-viewer"))).toEqual([
    "http://127.0.0.1:9427/viewer",
    "http://127.0.0.1:9427/viewer",
  ]);
});

test("a blocked independent window does not create a second viewer", async ({ page, context }) => {
  let loads = 0;
  await context.route("http://127.0.0.1:9427/viewer", (route) => {
    loads++;
    return route.fulfill({ contentType: "text/html", body: "<body>Isolated desktop</body>" });
  });
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.goto("/testing/browser-viewer");
  await expect(page.frameLocator("iframe").locator("body")).toHaveText("Isolated desktop");
  await page.getByRole("button", { name: "Open independent viewer" }).click();
  await expect(page.getByText("Independent window blocked; no ticket requested")).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  expect(loads).toBe(1);
});

test("an independent viewer rejects messages from its own host and the opener", async ({
  page,
  context,
}) => {
  await context.route("http://127.0.0.1:9427/viewer", (route) =>
    route.fulfill({ contentType: "text/html", body: "<body>Isolated unresponsive desktop</body>" }),
  );
  await page.goto("/testing/browser-viewer");
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open independent viewer" }).click();
  const popup = await opened;
  await expect(popup.locator("body")).toHaveText("Isolated unresponsive desktop");
  await expect(popup.locator("iframe")).toHaveCount(0);
  await page.evaluate(() =>
    window.postMessage({ type: "ftrade-browser-status", phase: "connected" }, "*"),
  );
  await popup.evaluate(() =>
    window.postMessage({ type: "ftrade-browser-status", phase: "connected" }, "*"),
  );
  await expect(popup.locator("body")).toHaveText("Isolated unresponsive desktop");
});

test("the production viewer window requires an authorized platform session", async ({ page }) => {
  await page.goto("/browser-viewer");
  await expect(page).toHaveURL(/\/auth(?:[?#]|$)/);
  await expect(page.locator('iframe[title="账号登录与两步验证"]')).toHaveCount(0);
});

test("a standalone window cannot authorize itself using its binding nonce", async ({ page }) => {
  const nonce = "11111111-1111-4111-8111-111111111111";
  await page.goto(`/testing/browser-viewer/window#${nonce}`);
  await expect(page.getByRole("status")).toContainText("正在等待工作台");
  await page.evaluate(async (nonce) => {
    window.postMessage({ type: "ftrade-viewer-window-bind", nonce }, location.origin);
    window.postMessage(
      {
        type: "ftrade-viewer-window-connection",
        nonce,
        connection: { origin: "http://127.0.0.1:9427", token: "isolated-viewer-fixture" },
      },
      location.origin,
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
    );
  }, nonce);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("正在等待工作台");
});

test("a direct window waits for the server ticket after its initial ready message", async ({
  page,
  context,
}) => {
  await context.route("http://127.0.0.1:9427/viewer", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "Content-Security-Policy": "sandbox allow-scripts allow-same-origin" },
      body: `<body>Pending desktop<script>
      let admissions = 0;
      addEventListener('message', e => {
        if(parent !== window || e.data.nonce !== location.hash.slice(1)) return;
        if(e.data.type === 'ftrade-browser-probe') {
          document.body.dataset.ready='yes';
          e.source.postMessage({type:'ftrade-browser-ready',nonce:e.data.nonce},e.origin);
        }
        if(e.data.type === 'ftrade-browser-ticket') document.body.dataset.admissions=String(++admissions);
      });
    </script>`,
    }),
  );
  await page.goto("/testing/browser-viewer");
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open pending independent viewer" }).click();
  const popup = await opened;
  await expect(popup.locator("body")).toHaveAttribute("data-ready", "yes");
  await expect(popup.locator("body")).not.toHaveAttribute("data-admissions");
  await page.getByRole("button", { name: "Authorize pending viewer" }).click();
  await expect(popup.locator("body")).toHaveAttribute("data-admissions", "1");
  await page.getByRole("button", { name: "Refresh fixture" }).click();
  await expect(popup.locator("body")).toHaveAttribute("data-admissions", "1");
});
