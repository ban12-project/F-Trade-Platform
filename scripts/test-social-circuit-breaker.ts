import assert from "node:assert/strict";
import { applyWorkerObservation, resumeSocialChannel, type SocialChannelCircuitState } from "../lib/social/circuit-breaker";

const active: SocialChannelCircuitState = { channelRef: "social-facebook", accountRef: "account-001", status: "active", stopReason: null, pausedAt: null };
const paused = applyWorkerObservation(active, { channelRef: active.channelRef, accountRef: active.accountRef, externalEffectCertain: false });
assert.equal(paused.status, "paused");
assert.equal(paused.stopReason, "external_result_unknown");
assert.equal(applyWorkerObservation(paused, { channelRef: active.channelRef, accountRef: active.accountRef, stopReason: "captcha", externalEffectCertain: true }), paused);
assert.throws(() => resumeSocialChannel(paused, "agent", "evidence-001"), /Only a human/);
assert.equal(resumeSocialChannel(paused, "human", "evidence-001").status, "active");
console.log("PASS social circuit breaker fails closed and requires human resume");
