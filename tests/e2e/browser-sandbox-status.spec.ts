import { expect, test } from "@playwright/test";

test("stored lifecycle remains distinguishable while provisioning is disabled", async ({
  page,
}) => {
  await page.goto("/testing/browser-sandbox-registration");
  const states = page.getByRole("region", { name: "合成生命周期状态" });
  for (const label of ["已停止", "正在启动", "运行中", "正在停止", "需要核对", "自管服务器"])
    await expect(states.getByText(label, { exact: true })).toBeVisible();
  await expect(states.getByText("不是云端实时状态。", { exact: false })).toHaveCount(5);
  await expect(states.getByText("尚未确认云端是否停止，请先核对，勿重复启动。")).toBeVisible();
  await expect(states.locator("time")).toHaveCount(5);
  await expect(states.locator("time").first()).toHaveAttribute(
    "datetime",
    "2026-09-01T00:00:00.000Z",
  );
  await expect(states.getByRole("button", { name: "检查云端状态" })).toHaveCount(5);
  await states.getByRole("button", { name: "检查云端状态" }).first().click();
  await expect(states.getByText("无法检查该节点，请确认管理权限与节点归属。")).toBeVisible();
  await expect(states.getByText("尚未确认云端是否停止，请先核对，勿重复启动。")).toBeVisible();
});
