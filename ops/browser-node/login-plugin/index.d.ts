export function validateLoginProfile(profile: unknown, now?: number): unknown;
export function createLoginFill(input: {
  sessions: Map<string, { tabGroups: Map<string, Map<string, { page: unknown }>> }>;
  accountId: string;
  runId: string;
  kind: string;
  profile: unknown;
  leaseDeadline(): number;
}): (packet: Record<string, unknown>) => Promise<{ outcome: string }>;
export function register(app: unknown, ctx: unknown, config?: unknown): void;
