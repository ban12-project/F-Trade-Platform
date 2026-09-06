import { createHmac, timingSafeEqual } from "node:crypto";
export function signProxyBootstrap(
  request: {
    requestId: string;
    workerId: string;
    channelRef: string;
    accountRef: string;
    at: number;
  },
  encodedKey: string,
) {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) throw new Error("proxy_bootstrap_key_invalid");
  return {
    request,
    signature: createHmac("sha256", key)
      .update("f-trade-proxy-bootstrap-v1\0")
      .update(JSON.stringify(request))
      .digest("base64url"),
  };
}
export function verifyProxyBootstrap(
  input: unknown,
  scope: { workerId: string; channelRef: string; accountRef: string },
  key: string,
  now = Date.now(),
) {
  const value = input as ReturnType<typeof signProxyBootstrap>;
  if (
    !value?.request ||
    Object.keys(value).sort().join() !== "request,signature" ||
    Object.keys(value.request).sort().join() !== "accountRef,at,channelRef,requestId,workerId" ||
    typeof value.signature !== "string"
  )
    throw new Error("proxy_bootstrap_invalid");
  const r = value.request;
  if (
    !/^[a-f0-9-]{36}$/.test(r.requestId) ||
    r.workerId !== scope.workerId ||
    r.channelRef !== scope.channelRef ||
    r.accountRef !== scope.accountRef ||
    !Number.isSafeInteger(r.at) ||
    r.at > now ||
    now - r.at > 30_000
  )
    throw new Error("proxy_bootstrap_invalid");
  const expected = Buffer.from(signProxyBootstrap(r, key).signature),
    supplied = Buffer.from(value.signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    throw new Error("proxy_bootstrap_invalid");
  return r;
}
