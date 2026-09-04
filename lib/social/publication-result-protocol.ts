import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

const MAX_RESULT_AGE_MS = 5 * 60_000;

export const signedPublicationResultBodySchema = z.object({
  result: z.object({
    workerId: z.string().trim().min(1).max(120),
    jobId: z.uuid(),
    outcome: z.enum(["published", "unknown", "failed"]),
    externalPublicationRef: z.string().trim().max(240).optional(),
    failureCode: z.string().trim().max(120).optional(),
    observedAt: z.iso.datetime(),
  }).strict().superRefine((value, context) => {
    if (value.outcome === "published" && !value.externalPublicationRef) context.addIssue({ code: "custom", path: ["externalPublicationRef"], message: "Published result requires an external reference" });
    if (value.outcome !== "published" && !value.failureCode) context.addIssue({ code: "custom", path: ["failureCode"], message: "Non-success result requires a failure code" });
  }),
  signature: z.string().trim().min(32).max(200),
}).strict();

export type PublicationWorkerResult = z.infer<typeof signedPublicationResultBodySchema>["result"];

function signingKey() {
  const encoded = process.env.SOCIAL_WORKER_SIGNING_KEY;
  if (!encoded) throw new Error("SOCIAL_WORKER_SIGNING_KEY is required for social worker results");
  const key = Buffer.from(encoded, "base64");
  if (key.length < 32) throw new Error("SOCIAL_WORKER_SIGNING_KEY must decode to at least 32 bytes");
  return key;
}

function canonical(result: PublicationWorkerResult) {
  return JSON.stringify({
    workerId: result.workerId,
    jobId: result.jobId,
    outcome: result.outcome,
    externalPublicationRef: result.externalPublicationRef ?? null,
    failureCode: result.failureCode ?? null,
    observedAt: result.observedAt,
  });
}

function signatureFor(result: PublicationWorkerResult) {
  return createHmac("sha256", signingKey()).update(canonical(result)).digest("base64url");
}

export function signPublicationWorkerResult(resultInput: PublicationWorkerResult) {
  const result = signedPublicationResultBodySchema.shape.result.parse(resultInput);
  return { result, signature: signatureFor(result) };
}

/** Verifies the isolated worker identity and freshness before accepting an external-effect result. */
export function verifyPublicationWorkerResult(bodyInput: unknown, expectedWorkerId: string, now = new Date()) {
  const body = signedPublicationResultBodySchema.parse(bodyInput);
  if (body.result.workerId !== expectedWorkerId) throw new Error("Publication result is addressed from an unexpected worker");
  const observedAt = new Date(body.result.observedAt);
  if (observedAt > now || now.getTime() - observedAt.getTime() > MAX_RESULT_AGE_MS) throw new Error("Publication result is expired or from the future");
  const expected = Buffer.from(signatureFor(body.result));
  const actual = Buffer.from(body.signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Publication result signature is invalid");
  return body.result;
}
