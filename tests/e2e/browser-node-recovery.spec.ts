import { expect, test } from "@playwright/test";
import { syntheticBrowserNodes } from "../fixtures/browser-nodes";

test("failed initial read offers a guarded read-only retry and clears on recovery", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  let fail = true;
  const requests: string[] = [];
  await page.route("**/testing/browser-nodes", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postData() ?? "");
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    if (fail) return route.fulfill({ status: 503, body: "Synthetic unavailable" });
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify(syntheticBrowserNodes())}\n`,
    });
  });
  await page.goto("/testing/browser-nodes");
  await expect(page.getByText("正在读取发布服务…", { exact: true })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  release?.();
  await expect(page.getByRole("alert").filter({ hasText: "无法读取发布服务" })).toContainText(
    "无法读取发布服务",
  );
  fail = false;
  await page.getByRole("button", { name: "重新读取发布服务", exact: true }).click();
  await expect(page.getByRole("button", { name: "正在重试…", exact: true })).toBeDisabled();
  await expect.poll(() => requests.length).toBe(2);
  release?.();
  await expect(page.getByText("合成已连接服务", { exact: false })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "无法读取发布服务" })).toHaveCount(0);
  expect(requests.every((body) => body === "[]")).toBe(true);
});

test("polling keeps stale rows on failure and clears the warning after automatic recovery", async ({
  page,
}) => {
  let fail = false;
  let recovered = false;
  const requests: string[] = [];
  await page.route("**/testing/browser-nodes", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postData() ?? "");
    if (fail) return route.fulfill({ status: 503, body: "Synthetic unavailable" });
    const rows = syntheticBrowserNodes();
    if (recovered) rows[0].name = "合成恢复后的服务";
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify(rows)}\n`,
    });
  });
  await page.goto("/testing/browser-nodes");
  await expect(page.getByText("合成已连接服务", { exact: false })).toBeVisible();
  fail = true;
  await expect(page.getByRole("alert").filter({ hasText: "无法读取发布服务" })).toContainText(
    "当前状态尚未确认",
    { timeout: 10_000 },
  );
  await expect(page.getByText("合成已连接服务", { exact: false })).toBeVisible();
  fail = false;
  recovered = true;
  await expect(page.getByText("合成恢复后的服务", { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("alert").filter({ hasText: "无法读取发布服务" })).toHaveCount(0);
  expect(requests.length).toBeGreaterThanOrEqual(3);
  expect(requests.every((body) => body === "[]")).toBe(true);
});
