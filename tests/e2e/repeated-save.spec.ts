import { expect, type Page, test } from "@playwright/test";

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

const syntheticPublishingAccount = {
  id: "00000000-0000-4000-8000-000000000701",
  nodeId: "00000000-0000-4000-8000-000000000702",
  name: "合成发布账号",
  platform: "Facebook",
  channelRef: "facebook-personal",
  accountRef: "synthetic-account-1",
  authorizationEnabled: true,
  loginState: "ready",
  credentialsSaved: true,
  publicationEnabled: false,
  publicationPaused: false,
  blockers: ["disabled"],
  ready: false,
};

function flight(value: unknown) {
  return `0:{"a":"$@1","f":"","b":"synthetic"}\n1:${JSON.stringify(value)}\n`;
}

async function setupChannelControlRoutes(
  page: Page,
  onControl: (
    payload: Record<string, FormDataEntryValue>,
    attempt: number,
  ) => Promise<{ status: "success" | "error"; message: string }>,
) {
  let accountsActionId: string | undefined;
  let nodesActionId: string | undefined;
  let accountsCalls = 0;
  let controlCalls = 0;
  await page.route("**/testing/agent-settings**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    const body = request.postData() ?? "";
    const actionId = request.headers()["next-action"] ?? "";
    if (body === "[]") {
      if (!accountsActionId || actionId === accountsActionId) {
        accountsActionId = actionId;
        accountsCalls++;
        return route.fulfill({
          contentType: "text/x-component",
          body: flight([{ ...syntheticPublishingAccount }]),
        });
      }
      if (!nodesActionId || actionId === nodesActionId) {
        nodesActionId = actionId;
        return route.fulfill({
          contentType: "text/x-component",
          body: flight([]),
        });
      }
      return route.fulfill({ contentType: "text/x-component", body: flight([]) });
    }
    controlCalls++;
    const data = await new Response(body, {
      headers: { "Content-Type": request.headers()["content-type"] },
    }).formData();
    const payload = Object.fromEntries(
      [...data.entries()].map(([key, value]) => [key.replace(/^_?\d+_/, ""), value]),
    );
    const result = await onControl(payload, controlCalls);
    return route.fulfill({
      contentType: "text/x-component",
      body: flight(result),
    });
  });
  return {
    getAccountsCalls: () => accountsCalls,
    getControlCalls: () => controlCalls,
  };
}

test("channel control repeated saves reset fields, preserve denial for retry, and survive refresh polls", async ({
  page,
}) => {
  const posts: Record<string, FormDataEntryValue>[] = [];
  const counters = await setupChannelControlRoutes(page, async (payload, attempt) => {
    posts.push(payload);
    return attempt === 3
      ? { status: "error", message: `SYNTHETIC control denied ${attempt}` }
      : { status: "success", message: `SYNTHETIC control saved ${attempt}` };
  });
  await page.goto("/testing/agent-settings");
  await page.getByRole("tab", { name: "渠道", exact: true }).click();
  const region = page.getByRole("region", { name: "发布账号", exact: true });
  await expect(region.getByText("Facebook · 合成发布账号", { exact: true })).toBeVisible();
  const actionSelect = region.getByLabel("要执行的操作", { exact: true });
  const reasonInput = region.getByLabel("处理情况或操作原因", { exact: true });
  const submitButton = region.getByRole("button", { name: "确认操作", exact: true });

  const steps = [
    { action: "pause", reason: "SYNTHETIC pause 1", denied: false },
    { action: "resume", reason: "SYNTHETIC resume 2", denied: false },
    { action: "enable", reason: "SYNTHETIC enable 3", denied: true },
    { action: null, reason: null, denied: false },
  ] as const;

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const attempt = index + 1;
    if (step.action && step.reason) {
      await actionSelect.selectOption(step.action);
      await reasonInput.fill(step.reason);
    }
    await submitButton.click();
    await expect(
      region.getByText(
        step.denied ? `SYNTHETIC control denied ${attempt}` : `SYNTHETIC control saved ${attempt}`,
        { exact: true },
      ),
    ).toBeVisible();
    expect(posts).toHaveLength(attempt);
    expect(posts.at(-1)).toMatchObject({
      channelRef: "facebook-personal",
      accountRef: "synthetic-account-1",
      action: step.action ?? "enable",
      evidenceRef: step.reason ?? "SYNTHETIC enable 3",
    });
    await expect(actionSelect).toHaveValue(step.denied ? "enable" : "");
    await expect(reasonInput).toHaveValue(step.denied ? "SYNTHETIC enable 3" : "");
  }

  await actionSelect.selectOption("pause");
  await reasonInput.fill("SYNTHETIC unsaved reason");
  const callsBeforePoll = counters.getAccountsCalls();
  await expect
    .poll(() => counters.getAccountsCalls(), { timeout: 10_000 })
    .toBeGreaterThan(callsBeforePoll);
  await expect(actionSelect).toHaveValue("pause");
  await expect(reasonInput).toHaveValue("SYNTHETIC unsaved reason");
});

test("channel control pending submission locks inputs and denial restores draft", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const counters = await setupChannelControlRoutes(page, async () => {
    await held;
    return { status: "error", message: "SYNTHETIC pending control denied" };
  });
  await page.goto("/testing/agent-settings");
  await page.getByRole("tab", { name: "渠道", exact: true }).click();
  const region = page.getByRole("region", { name: "发布账号", exact: true });
  await expect(region.getByText("Facebook · 合成发布账号", { exact: true })).toBeVisible();
  const form = region.locator("form");
  const actionSelect = region.getByLabel("要执行的操作", { exact: true });
  const reasonInput = region.getByLabel("处理情况或操作原因", { exact: true });
  const submitButton = region.locator('button[type="submit"]');

  await actionSelect.selectOption("pause");
  await reasonInput.fill("SYNTHETIC pending control reason");
  try {
    await submitButton.click();
    await expect.poll(() => counters.getControlCalls()).toBe(1);
    await expect(form).toHaveAttribute("aria-busy", "true");
    await expect(actionSelect).toBeDisabled();
    await expect(reasonInput).toBeDisabled();
    await expect(submitButton).toBeDisabled();
  } finally {
    release();
  }
  await expect(region.getByText("SYNTHETIC pending control denied", { exact: true })).toBeVisible();
  await expect(actionSelect).toBeEnabled();
  await expect(reasonInput).toBeEnabled();
  await expect(submitButton).toBeEnabled();
  await expect(actionSelect).toHaveValue("pause");
  await expect(reasonInput).toHaveValue("SYNTHETIC pending control reason");
});
