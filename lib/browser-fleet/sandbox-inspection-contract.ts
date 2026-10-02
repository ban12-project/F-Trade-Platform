import { z } from "zod";

export const sandboxInspectionSchema = z.object({ nodeId: z.uuid() }).strict();
export type SandboxInspection =
  | {
      kind: "unavailable";
      reason: "configuration" | "provider_authorization" | "provider_unavailable";
    }
  | {
      kind: "observed";
      observedAt: string;
      state: "stopped" | "running" | "transitioning";
      checks: { ownership: boolean; resources: boolean; timeout: boolean; networkPolicy: boolean };
    };
