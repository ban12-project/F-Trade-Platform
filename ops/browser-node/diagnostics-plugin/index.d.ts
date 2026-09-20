import type { Page } from "@playwright/test";
export function createConnectionDiagnostics(input: {
  sessions: Map<string, { tabGroups: Map<string, Map<string, { page: Page }>> }>;
  accountId: string;
  runId: string;
  leaseDeadline(): number;
}): {
  attach(event: { userId: string; page: Page }): void;
  read(query: { userId: string; runId: string; tabId: string }): null | {
    version: number;
    created: number;
    closed: number;
    errors: number;
    sentFrames: number;
    receivedFrames: number;
    dropped: number;
  };
};
