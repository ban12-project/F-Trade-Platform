export const workspaceMemberRoles = ["owner", "editor", "viewer"] as const;
export type WorkspaceMemberRole = (typeof workspaceMemberRoles)[number];
export type WorkspaceAccess = "view" | "write" | "manage" | "receipt";

const editors = ["owner", "editor"] as const;
export const memberRolesForAccess: Readonly<
  Record<WorkspaceAccess, readonly WorkspaceMemberRole[]>
> = {
  view: workspaceMemberRoles,
  write: editors,
  manage: ["owner"],
  receipt: editors,
};

// A summary can omit memberRole. Only an explicit read-only membership marks the UI read-only.
// Write authorization separately requires a matching membership row.
export function isReadOnlyMember(role: WorkspaceMemberRole | undefined) {
  return role !== undefined && !memberRolesForAccess.write.includes(role);
}
