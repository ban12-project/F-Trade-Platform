import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

const reference = z.string().trim().min(1).max(200);
export const facebookWorkerScopeSchema = z.object({
  workerId: reference,
  channelRef: reference,
  accountRef: reference,
}).strict();
export type FacebookWorkerScope = z.infer<typeof facebookWorkerScopeSchema>;

export const facebookInboundMessageSchema = z.object({
  conversationRef: reference,
  messageRef: reference,
  direction: z.literal("inbound"),
  identityQuality: z.literal("dom_id"),
  body: z.string().trim().min(1).max(20_000),
  receivedAt: z.iso.datetime(),
}).strict();

const common = {
  ...facebookWorkerScopeSchema.shape,
  requestId: z.uuid(),
  observedAt: z.iso.datetime(),
};
export const facebookWorkerRequestSchema = z.discriminatedUnion("operation", [
  z.object({ ...common, operation: z.literal("status") }).strict(),
  z.object({ ...common, operation: z.literal("claim") }).strict(),
  z.object({
    ...common,
    operation: z.literal("inbound"),
    messages: z.array(facebookInboundMessageSchema).min(1).max(20),
  }).strict(),
  z.object({
    ...common,
    operation: z.literal("pause"),
    reason: z.enum(["browser_unavailable", "page_contract_failed", "egress_ip_mismatch", "external_result_unknown", "worker_stopped", "login_required", "two_factor_required", "checkpoint_required"]),
  }).strict(),
]);
export type FacebookWorkerRequest = z.infer<typeof facebookWorkerRequestSchema>;
const envelopeSchema = z.object({
  request: facebookWorkerRequestSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();

export const facebookTextPayloadSchema = z.object({
  channelRef: reference,
  accountRef: reference,
  publicationId: z.uuid(),
  format: z.literal("text"),
  text: z.string().min(1).max(20_000).refine((value) => value.trim().length > 0),
}).strict();

function signingKey() {
  const key = Buffer.from(process.env.SOCIAL_WORKER_SIGNING_KEY ?? "", "base64");
  if (key.length < 32) throw new Error("facebook_worker_key_missing");
  return key;
}
function signature(request: FacebookWorkerRequest) {
  return createHmac("sha256", signingKey())
    .update("f-trade-facebook-worker-v1\0")
    .update(JSON.stringify(request))
    .digest("base64url");
}
export function signFacebookWorkerRequest(input: FacebookWorkerRequest) {
  const request = facebookWorkerRequestSchema.parse(input);
  return { request, signature: signature(request) };
}
export function verifyFacebookWorkerRequest(
  input: unknown,
  expected: FacebookWorkerScope,
  now = new Date(),
) {
  const envelope = envelopeSchema.parse(input);
  const request = envelope.request;
  const wanted = Buffer.from(signature(request));
  const supplied = Buffer.from(envelope.signature);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    throw new Error("facebook_worker_signature_invalid");
  }
  for (const field of ["workerId", "channelRef", "accountRef"] as const) {
    if (request[field] !== expected[field]) throw new Error("facebook_worker_scope_invalid");
  }
  const observedAt = Date.parse(request.observedAt);
  if (observedAt > now.getTime() || now.getTime() - observedAt > 300_000) {
    throw new Error("facebook_worker_request_expired");
  }
  if (request.operation === "inbound") {
    for (const message of request.messages) {
      const receivedAt = Date.parse(message.receivedAt);
      if (receivedAt > observedAt || now.getTime() - receivedAt >= 30 * 86_400_000) {
        throw new Error("facebook_message_time_invalid");
      }
    }
  }
  return request;
}
export function configuredFacebookWorkerScope() {
  return facebookWorkerScopeSchema.parse({
    workerId: process.env.SOCIAL_WORKER_ID,
    channelRef: process.env.SOCIAL_WORKER_CHANNEL_REF,
    accountRef: process.env.SOCIAL_WORKER_ACCOUNT_REF,
  });
}
