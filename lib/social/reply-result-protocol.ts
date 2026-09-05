import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

const MAX_RESULT_AGE_MS = 5 * 60_000;
const replyResultFields = {
  jobId: z.uuid(),
  outcome: z.enum(["sent", "unknown", "failed"]),
  externalMessageRef: z.string().trim().max(256).optional(),
  failureCode: z.string().trim().max(120).optional(),
} as const;

function validateOutcome(
  value: {
    outcome: "sent" | "unknown" | "failed";
    externalMessageRef?: string;
    failureCode?: string;
  },
  context: z.RefinementCtx,
) {
  if (value.outcome === "sent" && !value.externalMessageRef)
    context.addIssue({
      code: "custom",
      path: ["externalMessageRef"],
      message: "Sent result requires an external message reference",
    });
  if (value.outcome !== "sent" && !value.failureCode)
    context.addIssue({
      code: "custom",
      path: ["failureCode"],
      message: "Non-success result requires a failure code",
    });
}

export const replyResultSchema = z.object(replyResultFields).strict().superRefine(validateOutcome);

export const signedReplyResultBodySchema = z
  .object({
    result: z
      .object({
        ...replyResultFields,
        workerId: z.string().trim().min(1).max(120),
        observedAt: z.iso.datetime(),
      })
      .strict()
      .superRefine(validateOutcome),
    signature: z.string().trim().min(32).max(200),
  })
  .strict();

export type ReplyWorkerResult = z.infer<typeof signedReplyResultBodySchema>["result"];

function signingKey() {
  const encoded = process.env.SOCIAL_WORKER_SIGNING_KEY;
  if (!encoded) throw new Error("SOCIAL_WORKER_SIGNING_KEY is required for social worker results");
  const key = Buffer.from(encoded, "base64");
  if (key.length < 32)
    throw new Error("SOCIAL_WORKER_SIGNING_KEY must decode to at least 32 bytes");
  return key;
}

function canonical(result: ReplyWorkerResult) {
  return JSON.stringify({
    workerId: result.workerId,
    jobId: result.jobId,
    outcome: result.outcome,
    externalMessageRef: result.externalMessageRef ?? null,
    failureCode: result.failureCode ?? null,
    observedAt: result.observedAt,
  });
}

function signatureFor(result: ReplyWorkerResult) {
  return createHmac("sha256", signingKey()).update(canonical(result)).digest("base64url");
}

export function signReplyWorkerResult(resultInput: ReplyWorkerResult) {
  const result = signedReplyResultBodySchema.shape.result.parse(resultInput);
  return { result, signature: signatureFor(result) };
}

export function verifyReplyWorkerResult(
  bodyInput: unknown,
  expectedWorkerId: string,
  now = new Date(),
) {
  const body = signedReplyResultBodySchema.parse(bodyInput);
  if (body.result.workerId !== expectedWorkerId)
    throw new Error("Reply result is addressed from an unexpected worker");
  const observedAt = new Date(body.result.observedAt);
  if (observedAt > now || now.getTime() - observedAt.getTime() > MAX_RESULT_AGE_MS)
    throw new Error("Reply result is expired or from the future");
  const expected = Buffer.from(signatureFor(body.result));
  const actual = Buffer.from(body.signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("Reply result signature is invalid");
  return body.result;
}
