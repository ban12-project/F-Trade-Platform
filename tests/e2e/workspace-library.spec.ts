import { expect, test } from "@playwright/test";
import { libraryIds } from "../fixtures/workspace-library";

const root = "/testing/workspace-library/products";
const customers = "/testing/workspace-library/customers";
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
