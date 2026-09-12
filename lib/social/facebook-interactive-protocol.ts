import { createHmac, timingSafeEqual } from "node:crypto";

export type InteractiveTicket = {
  version: 1;
  id: string;
  workerId: string;
  channelRef: string;
  accountRef: string;
  appOrigin: string;
  gatewayOrigin: string;
  issuedAt: number;
  connectBefore: number;
  expiresAt: number;
};
export type InteractiveEvent = {
  id: string;
  requestId: string;
  at: number;
  operation: "claim" | "heartbeat" | "close" | "login" | "attention" | "verified";
  state?: "login_required" | "two_factor_required" | "checkpoint_required";
};
function secret(key: string) {
  const bytes = Buffer.from(key, "base64");
  if (bytes.length < 32) throw new Error("interactive_key_invalid");
  return bytes;
}
function mac(text: string, key: string) {
  return createHmac("sha256", secret(key)).update(text).digest("base64url");
}
function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function httpsOrigin(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("interactive_origin_invalid");
  return url.origin;
}
export function signInteractiveTicket(ticket: InteractiveTicket, key: string) {
  const data = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${data}.${mac(`ftrade-interactive-ticket-v1\0${data}`, key)}`;
}
export function verifyInteractiveTicket(
  token: string,
  key: string,
  expected: Pick<
    InteractiveTicket,
    "workerId" | "channelRef" | "accountRef" | "appOrigin" | "gatewayOrigin"
  >,
  now = Date.now(),
): InteractiveTicket {
  if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error("interactive_ticket_invalid");
  const [data, signature] = token.split(".");
  if (!equal(signature, mac(`ftrade-interactive-ticket-v1\0${data}`, key)))
    throw new Error("interactive_ticket_invalid");
  const v = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as InteractiveTicket;
  if (
    !v ||
    Object.keys(v).sort().join() !==
      [
        "version",
        "id",
        "workerId",
        "channelRef",
        "accountRef",
        "appOrigin",
        "gatewayOrigin",
        "issuedAt",
        "connectBefore",
        "expiresAt",
      ]
        .sort()
        .join() ||
    v.version !== 1 ||
    typeof v.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(v.id)
  )
    throw new Error("interactive_ticket_invalid");
  for (const field of [
    "workerId",
    "channelRef",
    "accountRef",
    "appOrigin",
    "gatewayOrigin",
  ] as const) {
    if (v[field] !== expected[field]) throw new Error("interactive_scope_invalid");
  }
  if (
    ![v.issuedAt, v.connectBefore, v.expiresAt].every(Number.isSafeInteger) ||
    v.issuedAt > now ||
    v.connectBefore <= now ||
    v.connectBefore <= v.issuedAt ||
    v.connectBefore - v.issuedAt > 60_000 ||
    v.expiresAt <= now ||
    v.expiresAt <= v.connectBefore ||
    v.expiresAt - v.issuedAt > 600_000
  )
    throw new Error("interactive_ticket_expired");
  return v;
}
export function signInteractiveEvent(event: InteractiveEvent, key: string) {
  return { event, signature: mac(`ftrade-interactive-event-v1\0${JSON.stringify(event)}`, key) };
}
export function verifyInteractiveEvent(input: unknown, key: string, now = Date.now()) {
  const v = input as ReturnType<typeof signInteractiveEvent>;
  if (
    !v?.event ||
    Object.keys(v).sort().join() !== "event,signature" ||
    typeof v.signature !== "string"
  )
    throw new Error("interactive_event_invalid");
  const keys =
    v.event.state === undefined ? "at,id,operation,requestId" : "at,id,operation,requestId,state";
  if (
    Object.keys(v.event).sort().join() !== keys ||
    !/^[a-f0-9-]{36}$/.test(v.event.id) ||
    !/^[a-f0-9-]{36}$/.test(v.event.requestId) ||
    !["claim", "heartbeat", "close", "login", "attention", "verified"].includes(
      v.event.operation,
    ) ||
    (v.event.operation === "attention"
      ? !["login_required", "two_factor_required", "checkpoint_required"].includes(
          v.event.state ?? "",
        )
      : v.event.state !== undefined) ||
    !Number.isSafeInteger(v.event.at) ||
    v.event.at > now ||
    now - v.event.at > 30_000 ||
    !equal(v.signature, mac(`ftrade-interactive-event-v1\0${JSON.stringify(v.event)}`, key))
  )
    throw new Error("interactive_event_invalid");
  return v.event;
}
