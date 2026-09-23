export function createAutomaticLoginRuntime(input: {
  sessions: Map<string, { tabGroups: Map<string, Map<string, { page: unknown }>> }>;
  accountId: string;
  runId: string;
  profile: unknown;
  leaseDeadline(): number;
}): (operation: string, packet: Record<string, unknown>) => Promise<Record<string, unknown>>;
