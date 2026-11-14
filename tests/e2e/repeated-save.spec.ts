import { expect, test } from "@playwright/test";

test("consecutive invitation results clear only successful submitted drafts", async ({ page }) => {
  let calls = 0;
  const emails: string[] = [];
  await page.route("**/testing/agent-settings**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    const request = route.request();
    const data = await new Response(request.postData() ?? "", {
      headers: { "Content-Type": request.headers()["content-type"] },
    }).formData();
    emails.push(String([...data.entries()].find(([key]) => /(?:^|_)email$/.test(key))?.[1]));
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify({ status: calls === 3 ? "error" : "success", message: calls === 3 ? "SYNTHETIC denied" : "SYNTHETIC saved" })}\n`,
    });
  });
  await page.goto("/testing/agent-settings");
  await page.getByRole("tab", { name: "团队", exact: true }).click();
  const email = page.getByLabel("受邀邮箱", { exact: true });
  for (let attempt = 1; attempt <= 4; attempt++) {
    const value = `synthetic-${attempt}@example.invalid`;
    await email.fill("");
    await email.pressSequentially(value);
    await page.getByRole("button", { name: "发送邀请", exact: true }).click();
    await expect.poll(() => calls).toBe(attempt);
    await expect(page.getByRole("button", { name: "发送邀请", exact: true })).toBeEnabled();
    await expect(
      page.getByText(attempt === 3 ? "SYNTHETIC denied" : "SYNTHETIC saved", { exact: true }),
    ).toBeVisible();
    await expect(email).toHaveValue(attempt === 3 ? value : "");
    expect(emails.at(-1)).toBe(value);
  }
  expect(calls).toBe(4);
});

test("each successful member removal closes its confirmation", async ({ page }) => {
  let calls = 0;
  await page.route("**/testing/project-workspace**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify({ status: "success", message: `SYNTHETIC removal ${calls}` })}\n`,
    });
  });
  await page.goto("/testing/project-workspace");
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.getByRole("button", { name: "成员 2", exact: true }).click();
    await page.getByRole("button", { name: "移除成员 Synthetic Viewer", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "移除项目成员？" });
    await dialog.getByRole("button", { name: "移除 Synthetic Viewer", exact: true }).click();
    await expect.poll(() => calls).toBe(attempt);
    await expect(dialog).toHaveCount(0);
  }
});

test("a previous member save must not dismiss a later removal denial", async ({ page }) => {
  let calls = 0;
  await page.route("**/testing/project-workspace**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    await route.fulfill({
      contentType: "text/x-component",
      body: `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify({ status: calls === 1 ? "success" : "error", message: calls === 1 ? "SYNTHETIC role saved" : "SYNTHETIC removal denied" })}\n`,
    });
  });
  await page.goto("/testing/project-workspace");
  await page.getByRole("button", { name: "成员 2", exact: true }).click();
  await page.getByLabel("注册邮箱", { exact: true }).fill("synthetic@example.invalid");
  await page.getByRole("button", { name: "保存成员角色", exact: true }).click();
  await expect(page.getByText("SYNTHETIC role saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "移除成员 Synthetic Viewer", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "移除项目成员？" });
  await dialog.getByRole("button", { name: "移除 Synthetic Viewer", exact: true }).click();
  await expect(dialog.getByText("SYNTHETIC removal denied", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保留成员", exact: true })).toBeEnabled();
  expect(calls).toBe(2);
});

test("invitation pending locks the submitted draft and denial restores it", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/testing/agent-settings**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    await held;
    await route.fulfill({
      contentType: "text/x-component",
      body: '0:{"a":"$@1","f":"","b":"synthetic"}\n1:{"status":"error","message":"SYNTHETIC invitation denied"}\n',
    });
  });
  await page.goto("/testing/agent-settings");
  await page.getByRole("tab", { name: "团队", exact: true }).click();
  const email = page.getByLabel("受邀邮箱", { exact: true });
  const save = page.getByRole("button", { name: "发送邀请", exact: true });
  await email.fill("synthetic-pending@example.invalid");
  try {
    await save.click();
    await expect.poll(() => calls).toBe(1);
    await expect(email).toBeDisabled();
    await expect(save).toBeDisabled();
    await expect(page.locator("#invite-user")).toHaveAttribute("aria-busy", "true");
  } finally {
    release();
  }
  await expect(page.getByText("SYNTHETIC invitation denied", { exact: true })).toBeVisible();
  await expect(email).toBeEnabled();
  await expect(email).toHaveValue("synthetic-pending@example.invalid");
  expect(calls).toBe(1);
});
