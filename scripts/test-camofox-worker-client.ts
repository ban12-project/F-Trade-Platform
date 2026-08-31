import assert from "node:assert/strict";
import { CamofoxWorkerClient } from "../lib/social/camofox-client";

const calls: Array<{ url: string; init?: RequestInit }> = [];
const mockFetch = async (input: URL | RequestInfo, init?: RequestInit) => {
  calls.push({ url: String(input), init });
  if (String(input).endsWith("/health")) return new Response(JSON.stringify({ ok: true, browserConnected: true, activeTabs: 0, activeSessions: 1 }), { status: 200 });
  if (String(input).endsWith("/tabs")) return new Response(JSON.stringify({ tabId: "tab-001" }), { status: 200 });
  return new Response(JSON.stringify({ snapshot: "- document", refsCount: 1 }), { status: 200 });
};
const client = new CamofoxWorkerClient({ baseUrl: "http://127.0.0.1:9377", accessKey: "a".repeat(32), userId: "facebook-profile-001", sessionKey: "controlled-session" }, mockFetch as typeof fetch);
async function main() {
  assert.equal((await client.healthcheck()).activeSessions, 1);
  assert.equal(await client.createFacebookTab(), "tab-001");
  assert.equal((await client.snapshot("tab-001")).refsCount, 1);
  assert.match(String(calls[1].init?.body), /"trace":false/);
  assert.throws(() => new CamofoxWorkerClient({ baseUrl: "https://browser.example", accessKey: "a".repeat(32), userId: "x", sessionKey: "y" }), /loopback/);
  console.log("PASS CamoFox Worker client is loopback-only and trace-free");
}

void main();
