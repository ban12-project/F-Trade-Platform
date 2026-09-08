export function loadLoginProfiles(
  path?: string,
): Promise<Map<string, { accountRef: string; channelRef: string; profile: unknown }>>;
export function loginScopes(
  profiles: Map<string, unknown>,
): Array<{ accountRef: string; channelRef: string; expiresAt: number }>;
export function loginProfileForRun(
  profiles: Map<string, unknown>,
  run: Record<string, unknown>,
): unknown;
export function configureLoginRuntime(
  spec: unknown,
  run: Record<string, unknown>,
  profile: unknown,
): void;
export function createSavedLoginExecutor(input: {
  run: { id: string; leaseId: string; accountId: string; kind: string };
  profile: unknown;
  assertActive(): void;
  checkEgress(): Promise<void>;
  request(operation: string, fields: Record<string, unknown>): Promise<Record<string, unknown>>;
  browserRequest(path: string, body?: Record<string, unknown>): Promise<Response>;
}): (notice: { id: string; expiresAt: number }) => Promise<string>;
