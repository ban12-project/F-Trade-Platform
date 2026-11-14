import { recordKindLabels } from "./library-model";
import { createKinds, isWorkspaceRecordKind } from "./navigation";

// Describe the task without copying business payloads or arbitrary URL text into browser history.
export function workspaceRecordTitle(kind: string, mode: "record" | "create") {
  if (!isWorkspaceRecordKind(kind)) return "业务记录";
  if (mode === "create") {
    // The RFQ entry can also select or redirect to existing linked requests.
    if (kind === "rfq") return "整理客户询盘";
    return (createKinds as readonly string[]).includes(kind)
      ? `新建${recordKindLabels[kind]}`
      : "业务记录";
  }
  return `${recordKindLabels[kind]}详情`;
}
