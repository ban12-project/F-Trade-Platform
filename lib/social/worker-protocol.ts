import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

const MAX_COMMAND_LIFETIME_MS = 5 * 60_000;

export const socialWorkerCommandSchema = z
  .object({
    commandId: z.string().trim().min(1).max(240),
    workerId: z.string().trim().min(1).max(240),
    jobId: z.string().trim().min(1).max(240),
    kind: z.enum(["publish", "observe_inbound", "reply"]),
    payloadRef: z.string().trim().min(1).max(240),
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{24,128}$/),
    issuedAt: z.coerce.date(),
    expiresAt: z.coerce.date(),
  })
  .strict()
  .superRefine((command, context) => {
    const lifetime = command.expiresAt.getTime() - command.issuedAt.getTime();
    if (lifetime <= 0 || lifetime > MAX_COMMAND_LIFETIME_MS) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Worker command lifetime must be between 1ms and 5 minutes",
      });
    }
  });
export type SocialWorkerCommand = z.infer<typeof socialWorkerCommandSchema>;

export type SignedSocialWorkerCommand = {
  command: SocialWorkerCommand;
  signature: string;
};

export interface WorkerNonceStore {
  /** Atomically returns false when the nonce was already accepted. */
  claim(workerId: string, nonce: string, expiresAt: Date): Promise<boolean>;
}

function signingKey() {
  const encoded = process.env.SOCIAL_WORKER_SIGNING_KEY;
  if (!encoded) throw new Error("SOCIAL_WORKER_SIGNING_KEY is required for social worker commands");
  const key = Buffer.from(encoded, "base64");
  if (key.length < 32)
    throw new Error("SOCIAL_WORKER_SIGNING_KEY must be a base64-encoded key of at least 32 bytes");
  return key;
}

function canonicalCommand(command: SocialWorkerCommand) {
  return JSON.stringify({
    commandId: command.commandId,
    workerId: command.workerId,
    jobId: command.jobId,
    kind: command.kind,
    payloadRef: command.payloadRef,
    payloadDigest: command.payloadDigest,
    nonce: command.nonce,
    issuedAt: command.issuedAt.toISOString(),
    expiresAt: command.expiresAt.toISOString(),
  });
}

function sign(command: SocialWorkerCommand) {
  return createHmac("sha256", signingKey()).update(canonicalCommand(command)).digest("base64url");
}

function canonicalPayload(payload: Record<string, unknown>) {
  function sorted(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sorted);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, sorted(item)]),
      );
    }
    return value;
  }
  // PostgreSQL jsonb changes nested key order. Normalize JSON values first,
  // then sort every object while preserving array order and scalar values.
  return JSON.stringify(sorted(JSON.parse(JSON.stringify(payload))));
}

export function digestSocialWorkerPayload(payload: Record<string, unknown>) {
  return createHash("sha256").update(canonicalPayload(payload)).digest("hex");
}

/** The isolated worker verifies the separately transported payload before using it. */
export function verifySocialWorkerPayload(
  command: SocialWorkerCommand,
  payload: Record<string, unknown>,
) {
  const expected = Buffer.from(command.payloadDigest, "hex");
  const actual = Buffer.from(digestSocialWorkerPayload(payload), "hex");
  if (!timingSafeEqual(actual, expected)) throw new Error("Worker payload digest is invalid");
  return payload;
}

export function signSocialWorkerCommand(input: SocialWorkerCommand): SignedSocialWorkerCommand {
  const command = socialWorkerCommandSchema.parse(input);
  return { command, signature: sign(command) };
}

function hasValidSignature(command: SocialWorkerCommand, signature: string) {
  const expected = Buffer.from(sign(command));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Verifies scope, expiry, signature and one-time nonce before a Worker performs an external effect. */
export async function verifySocialWorkerCommand(
  signed: SignedSocialWorkerCommand,
  expectedWorkerId: string,
  nonceStore: WorkerNonceStore,
  now = new Date(),
): Promise<SocialWorkerCommand> {
  const command = socialWorkerCommandSchema.parse(signed.command);
  if (command.workerId !== expectedWorkerId)
    throw new Error("Worker command is not addressed to this worker");
  if (command.issuedAt > now || command.expiresAt <= now)
    throw new Error("Worker command is expired or not yet valid");
  if (!hasValidSignature(command, signed.signature))
    throw new Error("Worker command signature is invalid");
  if (!(await nonceStore.claim(command.workerId, command.nonce, command.expiresAt))) {
    throw new Error("Worker command nonce has already been used");
  }
  return command;
}
