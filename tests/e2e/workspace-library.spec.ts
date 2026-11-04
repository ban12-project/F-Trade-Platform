import { expect, test } from "@playwright/test";
import { libraryIds } from "../fixtures/workspace-library";

const root = "/testing/workspace-library";
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
  await page.goto(`${root}?collection=customers&q=alice&project=${libraryIds.first}`);
  await expect(page.getByRole("link", { name: /客户：Synthetic Alice/ })).toHaveCount(4);
  await expect(page.getByRole("link", { name: /Synthetic Bob/ })).toHaveCount(0);
  await page.goto(`${root}?collection=customers&q=alice&project=${libraryIds.second}`);
  await expect(page.getByRole("link", { name: /客户：Synthetic Alice/ })).toHaveCount(0);
});
