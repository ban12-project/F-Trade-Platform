export const initialAgentSettingsActionState = { status: "idle", message: "" } as const;
export const initialContentAgentActionState = { status: "idle", message: "" } as const;
export const initialContentActionState = { status: "idle", message: "" } as const;
export const initialInvitationActionState = { status: "idle", message: "" } as const;
export const initialMarketingVideoActionState = { status: "idle", message: "" } as const;
export const initialInternetMediaSearchActionState: { status: "idle"; message: string; results: never[] } = { status: "idle", message: "", results: [] };
export const initialProductAgentActionState = { status: "idle", message: "" } as const;
export const initialProductActionState = { status: "idle", message: "" } as const;
export const initialSalesActionState = { status: "idle", message: "" } as const;
export const initialSocialControlActionState = { status: "idle", message: "" } as const;

export type ClosingActionState = {
  status: "idle" | "success" | "error";
  message: string;
  id?: string;
  projectId?: string;
};

export const initialClosingActionState: ClosingActionState = { status: "idle", message: "" };

export type ProductEvidenceActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const initialProductEvidenceActionState: ProductEvidenceActionState = { status: "idle", message: "" };
