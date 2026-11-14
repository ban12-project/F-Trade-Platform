import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { libraryIds } from "../fixtures/workspace-library";

const root = "/testing/workspace-library/products";
const customers = "/testing/workspace-library/customers";

test("library controls wait for hydration before accepting filter changes", async ({ page }) => {
  let release = () => {};
  const scriptsReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
    await scriptsReady;
    await route.continue();
  });
  const project = page.getByRole("combobox", { name: "归属项目" });
  try {
    await page.goto(`${customers}?project=${libraryIds.first}&q=alice`, { waitUntil: "commit" });
    await expect(project).toBeVisible();
    await expect(project).toBeDisabled();
    await expect(page.getByRole("searchbox", { name: "搜索记录" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "移除筛选：关键词：alice" })).toBeDisabled();
    await expect(page.getByRole("status").filter({ hasText: "找到 4 条记录" })).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(project).toBeEnabled();
  await project.selectOption(libraryIds.second);
  await expect(page).toHaveURL(`${customers}?project=${libraryIds.second}&q=alice`);
  await expect(page.getByRole("status").filter({ hasText: "找到 0 条记录" })).toBeVisible();
});

test("filter summary counts results and removes one condition with keyboard focus and history", async ({
  page,
}) => {
  await page.goto(
    `${customers}?project=${libraryIds.first}&type=rfq&state=RFQ_COLLECTING&q=missing`,
  );
  const status = page.getByRole("status").filter({ hasText: /条记录|正在更新/ });
  await expect(status).toHaveText("找到 0 条记录");
  const filters = page.getByRole("list", { name: "已选筛选条件" });
  await expect(filters.getByRole("button")).toHaveCount(4);
  const removeSearch = filters.getByRole("button", { name: "移除筛选：关键词：missing" });
  await expect(removeSearch).toBeEnabled();
  await removeSearch.focus();
  await expect(removeSearch).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    `${customers}?project=${libraryIds.first}&type=rfq&state=RFQ_COLLECTING`,
  );
  await expect(status).toHaveText("找到 1 条记录");
  await expect(page.getByRole("searchbox", { name: "搜索记录" })).toBeFocused();
  await expect(filters.getByRole("button")).toHaveCount(3);
  await page.reload();
  await expect(status).toHaveText("找到 1 条记录");
  await page.goBack();
  await expect(status).toHaveText("找到 0 条记录");
  await expect(removeSearch).toBeVisible();
});

test("individual filter removal preserves dirty drafts until confirmed", async ({ page }) => {
  await page.goto(`${customers}?project=${libraryIds.first}&type=rfq&state=RFQ_COLLECTING&q=alice`);
  await page.getByLabel("测试草稿").fill("Synthetic pending change");
  const removeType = page.getByRole("button", { name: "移除筛选：类型：客户询盘" });
  await removeType.click();
  const confirmation = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await confirmation.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(/type=rfq&state=RFQ_COLLECTING&q=alice/);
  await expect(page.getByLabel("测试草稿")).toHaveValue("Synthetic pending change");
  await removeType.click();
  await confirmation.getByRole("button", { name: "放弃修改并离开" }).click();
  await expect(page).toHaveURL(
    `${customers}?project=${libraryIds.first}&state=RFQ_COLLECTING&q=alice`,
  );
  await expect(page.getByRole("combobox", { name: "记录类型" })).toBeFocused();
});

test("long and unknown filters stay accessible and recoverable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const longSearch = "SYNTHETIC".repeat(22);
  await page.goto(
    `${root}?project=private-project-code&type=constructor&state=private-state&q=${longSearch}`,
  );
  await expect(page.getByRole("status").filter({ hasText: "项目不可访问" })).toBeVisible();
  const filters = page.getByRole("list", { name: "已选筛选条件" });
  await expect(filters).not.toContainText("private-project-code");
  await expect(filters).not.toContainText("constructor");
  await expect(filters).not.toContainText("private-state");
  for (const button of await filters.getByRole("button").all()) {
    const bounds = await button.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const audit = await new AxeBuilder({ page }).include('[aria-label="已选筛选条件"]').analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole("button", { name: "清除全部筛选" }).click();
  await expect(page.getByRole("status").filter({ hasText: "共 2 条记录" })).toBeVisible();
  await expect(filters).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "搜索记录" })).toBeFocused();
});
test("business search keeps identifiers and URL state across reload and history", async ({
  page,
}) => {
  await page.goto(root);
  const search = page.getByRole("searchbox", { name: "搜索记录" });
  await expect(page.getByRole("link", { name: /Synthetic clutch kit/ })).toContainText(
    "SKU：SYN-CLUTCH-001",
  );
  await search.fill("synoe1002");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=synoe1002/);
  await expect(page.getByRole("link", { name: /Synthetic bearing/ })).toHaveCount(0);
  const result = page.getByRole("link", { name: /Synthetic clutch kit/ });
  await expect(result).toBeVisible();
  expect(
    new URL((await result.getAttribute("href")) ?? "", "http://synthetic.invalid").searchParams.get(
      "returnTo",
    ),
  ).toBe("/workspace/products?q=synoe1002");
  await page.reload();
  await expect(search).toHaveValue("synoe1002");
  await search.fill("bearing");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("link", { name: /Synthetic bearing/ })).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue("synoe1002");
  await expect(result).toBeVisible();
  await page.goForward();
  await expect(search).toHaveValue("bearing");
  await search.fill("");
  await search.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${root}$`));
  await expect(result).toBeVisible();
});

test("customer search includes linked records and respects project scope", async ({ page }) => {
  await page.goto(`${customers}?q=alice&project=${libraryIds.first}`);
  await expect(page.getByRole("link", { name: /客户：Synthetic Alice/ })).toHaveCount(4);
  await expect(page.getByRole("link", { name: /Synthetic Bob/ })).toHaveCount(0);
  await page.goto(`${customers}?q=alice&project=${libraryIds.second}`);
  await expect(page.getByRole("link", { name: /客户：Synthetic Alice/ })).toHaveCount(0);
});

test("project and type changes clear only incompatible dependent filters", async ({ page }) => {
  await page.goto(`${customers}?project=${libraryIds.first}&type=quotation&state=QUOTE_DRAFT`);
  await page.getByRole("combobox", { name: "归属项目" }).selectOption(libraryIds.second);
  await expect(page).toHaveURL(`${customers}?project=${libraryIds.second}`);
  await expect(page.getByRole("combobox", { name: "记录类型" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "状态", exact: true })).toHaveValue("");
  await expect(page.getByRole("option", { name: "人工报价", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "记录类型" }).selectOption("rfq");
  await page.getByRole("combobox", { name: "状态", exact: true }).selectOption("RFQ_READY");
  await page.getByRole("combobox", { name: "归属项目" }).selectOption(libraryIds.first);
  await expect(page.getByRole("combobox", { name: "记录类型" })).toHaveValue("rfq");
  await expect(page.getByRole("combobox", { name: "状态", exact: true })).toHaveValue("");
  await page.getByRole("combobox", { name: "状态", exact: true }).selectOption("RFQ_COLLECTING");
  await page.getByRole("combobox", { name: "记录类型" }).selectOption("quotation");
  await expect(page.getByRole("combobox", { name: "状态", exact: true })).toHaveValue("");
  await expect(page.getByRole("link", { name: /人工报价/ })).toHaveCount(1);
});

test("clear all resets search and dependent filters and respects dirty navigation cancellation", async ({
  page,
}) => {
  await page.goto(`${customers}?project=${libraryIds.first}&type=rfq&state=RFQ_COLLECTING&q=alice`);
  await page.getByLabel("测试草稿").fill("Synthetic unsaved draft");
  const clear = page.getByRole("button", { name: "清除全部筛选" });
  await clear.click();
  const confirm = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await confirm.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(/q=alice/);
  await expect(page.getByLabel("测试草稿")).toHaveValue("Synthetic unsaved draft");
  await clear.click();
  await confirm.getByRole("button", { name: "放弃修改并离开" }).click();
  await expect(page).toHaveURL(customers);
  await expect(page.getByRole("searchbox", { name: "搜索记录" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "归属项目" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "记录类型" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "状态", exact: true })).toHaveValue("");
  await expect(clear).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Synthetic Bob/ })).toHaveCount(1);
});

test("empty, unmatched and inaccessible project states stay distinct and recoverable", async ({
  page,
}) => {
  await page.goto(`${root}?empty=1`);
  await expect(page.getByText("暂无产品资料记录", { exact: true })).toBeVisible();
  await page.goto(`${root}?q=no-such-synthetic-item`);
  await expect(page.getByText("没有匹配的记录", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清除全部筛选" }).click();
  await expect(page.getByRole("link", { name: /Synthetic clutch kit/ })).toBeVisible();
  await page.goto(`${root}?project=inaccessible&type=obsolete&state=obsolete`);
  await expect(page.getByText("这个项目不可访问", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "记录类型" })).toHaveValue("obsolete");
  await page.getByRole("button", { name: "清除全部筛选" }).click();
  await expect(page.getByRole("link", { name: /Synthetic clutch kit/ })).toBeVisible();
});

for (const invalid of [
  { query: `q=${"x".repeat(201)}`, message: "搜索内容不能超过 200 个字符" },
  { query: "q=alice&q=bob", message: "搜索链接格式无效，请重新输入关键词。" },
]) {
  test(`invalid search is explicit and preserves other filters: ${invalid.message}`, async ({
    page,
  }) => {
    const scope = `project=${libraryIds.first}&type=product&state=PRODUCT_READY`;
    await page.goto(`${root}?${scope}&${invalid.query}`);
    const search = page.getByRole("searchbox", { name: "搜索记录", exact: true });
    await expect(search).toHaveAccessibleDescription(invalid.message);
    await expect(search).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("无法执行搜索", { exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "资料库记录", exact: true })).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "搜索条件无效" })).toBeVisible();
    await page.getByRole("button", { name: "清除无效搜索", exact: true }).click();
    await expect(page).toHaveURL(`${root}?${scope}`);
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute("aria-invalid", "false");
    await expect(page.getByRole("list", { name: "资料库记录", exact: true })).toBeVisible();
    await page.goBack();
    await expect(search).toHaveAccessibleDescription(invalid.message);
    await search.fill("SYN-CLUTCH-001");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page).toHaveURL(`${root}?${scope}&q=SYN-CLUTCH-001`);
    await expect(search).not.toHaveAttribute("aria-describedby");
    await expect(page.getByRole("list", { name: "资料库记录", exact: true })).toContainText(
      "Synthetic clutch kit",
    );
  });
}

for (const collection of ["products", "customers", "content"]) {
  for (const width of [320, 390]) {
    test(`long project names remain readable in ${collection} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/testing/workspace-library/${collection}?long=1`);
      const list = page.getByRole("list", { name: "资料库记录", exact: true });
      await expect(list).toBeVisible();
      await expect(list).toContainText(`SyntheticProject${"X".repeat(104)}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      for (const link of await list.getByRole("link").all()) {
        await link.focus();
        await expect(link).toBeFocused();
        expect(await link.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
      }
    });
  }
}

for (const scenario of [
  {
    collection: "products",
    scope: "",
    action: "录入产品",
    message: "产品资料需在营销项目录入；销售项目仅引用产品。",
    kind: "营销",
  },
  {
    collection: "content",
    scope: "",
    action: "制作内容",
    message: "内容和视频需在营销项目中制作。",
    kind: "营销",
  },
  {
    collection: "customers",
    scope: "marketing",
    action: "记录询盘",
    message: "客户询盘需记录在销售项目中。",
    kind: "销售",
  },
  {
    collection: "customers",
    scope: "viewer",
    action: "记录询盘",
    message: "你在此项目只有查看权限，不能新增记录。",
    kind: "销售",
  },
  {
    collection: "customers",
    scope: "archived",
    action: "记录询盘",
    message: "此项目已归档，不能新增记录。",
    kind: "销售",
  },
]) {
  test(`unavailable creation explains and recovers ${scenario.collection}/${scenario.scope || "sales"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const path = `/testing/workspace-library/${scenario.collection}?project=${libraryIds.first}&scope=${scenario.scope}`;
    await page.goto(path);
    await expect(page.getByRole("button", { name: scenario.action, exact: true })).toBeDisabled();
    const explanation = page.getByRole("region", { name: "新增记录说明" });
    await expect(explanation).toContainText(scenario.message);
    const recovery = explanation.getByRole("button", { name: "选择其他项目开始" });
    await expect(recovery).toBeEnabled();
    await recovery.click();
    const dialog = page.getByRole("dialog", { name: "开始新工作" });
    await expect(dialog).toBeVisible();
    const projects = dialog.getByRole("combobox", { name: "归属项目" });
    await expect(projects).toHaveValue("");
    await expect(projects.getByRole("option")).toHaveCount(2);
    await expect(
      projects.getByRole("option", { name: `创建新的${scenario.kind}项目` }),
    ).toBeAttached();
    await expect(
      dialog.getByRole("button", { name: `在此项目开始${scenario.action}` }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(path);
    await expect(recovery).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
}

test("compatible editable library scope retains its direct creation action", async ({ page }) => {
  await page.goto(`${customers}?project=${libraryIds.first}`);
  await expect(page.getByRole("button", { name: "记录询盘", exact: true })).toBeEnabled();
  await expect(page.getByRole("region", { name: "新增记录说明" })).toHaveCount(0);
});
