import { expect, test } from "@playwright/test";

for (const operation of ["copy", "create"] as const)
  test(`successful content ${operation} cannot create again while destination is loading`, async ({
    page,
  }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posts = 0;
    let navigating = false;
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname !== "127.0.0.1") return route.abort();
      if (url.pathname.includes("/records/content/")) {
        navigating = true;
        await held;
        return route.abort();
      }
      if (url.pathname === "/testing/project-workflow" && request.method() === "POST") {
        posts++;
        if (posts === 1)
          return route.fulfill({
            contentType: "text/x-component",
            body: '0:{"a":"$@1","f":"","b":"synthetic"}\n1:{"status":"error","message":"SYNTHETIC denied"}\n',
          });
        return route.fulfill({
          contentType: "text/x-component",
          body: '0:{"a":"$@1","f":"","b":"synthetic"}\n1:{"status":"success","message":"SYNTHETIC copied","contentId":"00000000-0000-4000-8000-000000000998"}\n',
        });
      }
      return route.continue();
    });
    await page.goto("/testing/project-workflow?record=content&state=content-copy");
    const submit =
      operation === "copy"
        ? page.getByRole("button", { name: "复制为新草稿", exact: true })
        : page.locator('button[type="submit"][form="create-content"]');
    if (operation === "create") {
      const form = page.locator("form#create-content");
      for (const label of ["开场句", "正文", "行动号召", "视觉说明"])
        await form.getByLabel(label, { exact: true }).fill("SYNTHETIC submitted content");
    }
    try {
      await submit.click();
      await expect(page.getByText("SYNTHETIC denied", { exact: true })).toBeVisible();
      await expect(submit).toBeEnabled();
      if (operation === "create")
        await expect(
          page.locator("form#create-content").getByLabel("正文", { exact: true }),
        ).toHaveValue("SYNTHETIC submitted content");
      await submit.click();
      await expect.poll(() => navigating).toBe(true);
      await expect(submit).toBeDisabled();
      expect(posts).toBe(2);
      const recovery = page.getByRole("button", {
        name: operation === "copy" ? "打开复制的内容草稿" : "打开内容草稿",
        exact: true,
      });
      await expect(recovery).toHaveAttribute(
        "href",
        /\/records\/content\/00000000-0000-4000-8000-000000000998$/,
      );
    } finally {
      release();
    }
  });
