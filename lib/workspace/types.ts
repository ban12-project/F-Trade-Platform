import type { WorkspaceRecordKind } from "./navigation";

export type WorkspaceTaskDestination =
  | { type: "record"; kind: WorkspaceRecordKind; id: string }
  | {
      type: "create";
      kind: WorkspaceRecordKind;
      source?: { kind: "product" | "rfq" | "lead"; id: string };
    };

export type WorkspaceProjectSummary = {
  memberRole?: "owner" | "editor" | "viewer";
  id: string;
  title: string;
  kind: "marketing" | "sales";
  status: "active" | "archived";
  updatedAt: Date;
};
export type WorkspaceProductReference = { id: string; productName: string; internalSku: string };
export type WorkspaceTaskSummary = {
  id: string;
  projectId: string;
  projectTitle: string;
  recordKind:
    | "product"
    | "content"
    | "video"
    | "publication"
    | "rfq"
    | "quotation"
    | "lead"
    | "delivery";
  title: string;
  detail: string;
  priority: "attention" | "overdue" | "review" | "complete";
  state?: "actionable" | "waiting" | "processing" | "attention" | "scheduled";
  responsibleLabel?: string;
  source?: { kind: "product" | "rfq" | "lead"; id: string };
  destination: WorkspaceTaskDestination;
  createdAt: Date;
  dueAt?: Date;
  actionLabel?: string;
  taskType?:
    | "approval"
    | "follow_up"
    | "publication"
    | "rfq"
    | "opportunity"
    | "revision"
    | "create"
    | "send"
    | "processing";
};
export type WorkspaceProjectOverview = WorkspaceProjectSummary & {
  statusLabel: string;
  taskCount: number;
  nextAction: string;
  nextActionHref?: string;
  recordCount: number;
  publishedCount: number;
  leadCount: number;
  opportunityCount: number;
  relatedMarketingProjectTitle?: string;
};
