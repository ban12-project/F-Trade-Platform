export function createInboxReporter(context: {
  run: { kind: string; id: string; leaseId: string; inboxSigningKey: string };
  assertActive(): void;
  checkEgress(): Promise<void>;
  request(operation: string, fields: Record<string, unknown>): Promise<Record<string, unknown>>;
}): (
  messages: Array<Record<string, unknown>>,
  observedAt: string,
  completion?: Record<string, unknown>,
) => Promise<{ accepted: number; duplicates: number; replayed: boolean }>;
