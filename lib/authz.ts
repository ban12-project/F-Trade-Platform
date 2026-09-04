export const appRoles = ["admin", "user"] as const;
export type AppRole = (typeof appRoles)[number];

export const permissions = [
  "workspace:view",
  "product:write",
  "product:review",
  "content:write",
  "content:review",
  "video:write",
  "sales:write",
  "quotation:review",
  "delivery:review",
  "settings:manage",
  "team:manage",
] as const;
export type Permission = (typeof permissions)[number];

const rolePermissions: Record<AppRole, readonly Permission[]> = {
  user: ["workspace:view", "product:write", "content:write", "video:write", "sales:write"],
  admin: permissions,
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (appRoles as readonly string[]).includes(value);
}

export function hasPermission(role: unknown, permission: Permission) {
  return isAppRole(role) && rolePermissions[role].includes(permission);
}

export function roleLabel(role: unknown) {
  return role === "admin" ? "管理员" : "业务员";
}
