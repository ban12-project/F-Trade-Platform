export function validateInboxProfile(value: unknown, now?: number): unknown;
export function createFacebookInbox(
  profile: unknown,
  request: (path: string, body?: Record<string, unknown>) => Promise<Response>,
): (context: {
  run: { kind: string; id: string; accountId: string; channelRef: string; accountRef: string };
  signal: AbortSignal;
  reportInbound(
    messages: Array<Record<string, unknown>>,
    observedAt: string,
    completion?: Record<string, unknown>,
  ): Promise<unknown>;
}) => Promise<
  "completed" | "failed" | "needs_login" | "needs_2fa" | "checkpoint" | "page_contract_failed"
>;
