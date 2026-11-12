import type { WorkspaceProjectSummary } from "./types";

export type NewWorkIntent = "product" | "content" | "rfq" | "video";

// Presentation only. Server Actions independently enforce authorization and project state.
export function workspaceCreationRestriction(
  project: WorkspaceProjectSummary | undefined,
  intent: NewWorkIntent,
): string | undefined {
  if (!project) return "此项目不可访问，请选择其他项目。";
  if (project.status !== "active") return "此项目已归档，不能新增记录。";
  if (project.memberRole === "viewer") return "你在此项目只有查看权限，不能新增记录。";
  if (project.kind !== (intent === "rfq" ? "sales" : "marketing")) {
    if (intent === "rfq") return "客户询盘需记录在销售项目中。";
    if (intent === "product") return "产品资料需在营销项目录入；销售项目仅引用产品。";
    return "内容和视频需在营销项目中制作。";
  }
  return undefined;
}
