import { expect, test } from "@playwright/test";

import { hasPermission, roleLabel } from "../../lib/authz";

test("business users can execute work but cannot approve or manage the system", () => {
  expect(hasPermission("user", "product:write")).toBe(true);
  expect(hasPermission("user", "content:write")).toBe(true);
  expect(hasPermission("user", "video:write")).toBe(true);
  expect(hasPermission("user", "sales:write")).toBe(true);
  expect(hasPermission("user", "product:review")).toBe(false);
  expect(hasPermission("user", "content:review")).toBe(false);
  expect(hasPermission("user", "settings:manage")).toBe(false);
  expect(hasPermission("user", "team:manage")).toBe(false);
});

test("administrators retain every workspace capability", () => {
  expect(hasPermission("admin", "workspace:view")).toBe(true);
  expect(hasPermission("admin", "product:review")).toBe(true);
  expect(hasPermission("admin", "content:review")).toBe(true);
  expect(hasPermission("admin", "settings:manage")).toBe(true);
  expect(hasPermission("admin", "team:manage")).toBe(true);
  expect(roleLabel("admin")).toBe("管理员");
  expect(roleLabel("user")).toBe("业务员");
});
