import type { PublicationDriver } from "./publication-executor.mjs";
export function validateFacebookProfile(value: unknown, now?: number): unknown;
export function createFacebookDriver(
  profile: unknown,
  request: (path: string, body?: Record<string, unknown>) => Promise<Response>,
): PublicationDriver<unknown>;
