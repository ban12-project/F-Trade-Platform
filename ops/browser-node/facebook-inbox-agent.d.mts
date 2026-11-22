export function validateLiveInboxProfile(value: unknown, now?: number): unknown;
export function summarizeAriaSnapshot(rawSnapshot: string): string;
export function createFacebookLiveInboxAgent(
  profile: unknown,
  request: (path: string, body?: Record<string, unknown>) => Promise<Response>,
  decideInboxAction: (input: {
    snapshot: { controls: Array<{ id: string; label: string; actions: string[] }>; state: string };
    context: {
      remainingCalls: number;
      unchangedObservations: number;
      recentActions: Array<{ action: string; changed: boolean }>;
    };
  }) => Promise<{ command: unknown }>,
): (context: {
  run: { kind: string; id: string; accountId: string; channelRef: string; accountRef: string };
  signal: AbortSignal;
  reportInbound(
    messages: Array<Record<string, unknown>>,
    observedAt: string,
    completion?: Record<string, unknown>,
  ): Promise<unknown>;
  onInboxFailure?: (code: string) => void;
  onInboxThreadStats?: (stats: Record<string, number>) => void;
}) => Promise<
  "completed" | "failed" | "needs_login" | "needs_2fa" | "checkpoint" | "page_contract_failed"
>;
