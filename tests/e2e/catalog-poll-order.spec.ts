import { expect, test } from "@playwright/test";

test("catalog polling pauses during manual refresh and resumes after it settles", async ({
  page,
}) => {
  await page.clock.install();
  let reads = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const projectId = "00000000-0000-4000-8000-000000000202";
  const importId = "00000000-0000-4000-8000-000000000901";
  await page.route("**/testing/project-workflow?**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const [input] = JSON.parse(route.request().postData() ?? "[]");
    let completed = false;
    if (typeof input === "string") expect(input).toBe(projectId);
    else {
      // Only reads are permitted in this scenario.
      expect(input).toEqual({ projectId, importId });
      reads++;
      if (reads === 1) await held;
      else completed = true;
    }
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify({ status: "success", view: { id: importId, status: completed ? "ready" : "parsing", failureCode: null, candidates: [] } })}\n`,
    });
  });
  try {
    await page.goto("/testing/project-workflow?record=product");
    await page.getByRole("tab", { name: "产品目录", exact: true }).click();
    const refresh = page.getByRole("button", { name: "刷新进度", exact: true });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect.poll(() => reads).toBe(1);
    await expect(refresh).toBeDisabled();
    // Cross two normal polling intervals while the older manual response is held.
    await page.clock.runFor(4_100);
    expect(reads).toBe(1);
    await expect(page.getByText("正在解析目录", { exact: true })).toBeVisible();
    release();
    await expect(refresh).toBeEnabled();
    await page.clock.runFor(2_100);
    await expect.poll(() => reads).toBe(2);
    await expect(page.getByText("0 条候选", { exact: true })).toBeVisible();
    await page.clock.runFor(4_100);
    expect(reads).toBe(2);
  } finally {
    release();
  }
});
