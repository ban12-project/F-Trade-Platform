import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { fixture } from "../evals/browser-agent/fixture";
import { type Decide, type Port, runBrowserAgent } from "../lib/browser-agent/runtime";

const signal = () => new AbortController().signal;
const decide =
  (action: string, target = "", valueRef = ""): Decide =>
  async () => ({ command: { action, target, valueRef } });
const port = (): Port => ({
  capabilities: [],
  async observe() {
    return { controls: [], state: "stable" };
  },
  async verify() {
    return false;
  },
});

test("model completion never substitutes for independent evidence", async () => {
  const result = await runBrowserAgent({
    port: port(),
    decide: decide("finish"),
    signal: signal(),
  });
  assert.equal(result.reason, "unverified");
  assert.equal(result.outcome, "stopped");
});
test("publish, arbitrary navigation and command injection have no capability", async () => {
  for (const action of ["publish", "click", "navigate", "upload", "evaluate"]) {
    const result = await runBrowserAgent({
      port: port(),
      decide: decide(action, "publish", "https://evil.invalid"),
      signal: signal(),
    });
    assert.equal(result.reason, "invalid_action");
  }
});
test("three unchanged observations stop the loop", async () => {
  const result = await runBrowserAgent({ port: port(), decide: decide("read"), signal: signal() });
  assert.equal(result.reason, "no_progress");
  assert.equal(result.calls, 3);
});
test("changing observations still stop at forty calls", async () => {
  let state = 0;
  const p = port();
  p.observe = async () => ({ controls: [], state: String(state++) });
  const result = await runBrowserAgent({ port: p, decide: decide("read"), signal: signal() });
  assert.equal(result.reason, "limit");
  assert.equal(result.calls, 40);
});
test("model timeout returns and cannot execute a later decision", async () => {
  let effects = 0;
  const p = port();
  p.capabilities = [
    {
      action: "click",
      target: "allowed",
      valueRefs: [""],
      async execute() {
        effects++;
      },
    },
  ];
  const result = await runBrowserAgent({
    port: p,
    decide: async () => {
      await new Promise((r) => setTimeout(r, 60));
      return { command: { action: "click", target: "allowed", valueRef: "" } };
    },
    signal: signal(),
    timeoutMs: 10,
  });
  assert.equal(result.reason, "cancelled");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(effects, 0);
});
test("lease cancellation prevents observation and effects", async () => {
  const controller = new AbortController();
  controller.abort();
  let observations = 0;
  const p = port();
  p.observe = async () => {
    observations++;
    return { controls: [], state: "" };
  };
  assert.equal(
    (await runBrowserAgent({ port: p, decide: decide("read"), signal: controller.signal })).reason,
    "cancelled",
  );
  assert.equal(observations, 0);
});
test("credentials stay out of observations and audit; publish is single use", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    const login = await fixture(page, "login", "normal", "none");
    await login.port.capabilities[0].execute("credential", signal());
    assert.equal(
      JSON.stringify(await login.port.observe(signal())).includes("SYNTHETIC-secret-canary"),
      false,
    );
    const publication = await fixture(page, "text", "normal", "injection");
    const rejected = await runBrowserAgent({
      port: publication.port,
      decide: decide("click", "publish"),
      signal: signal(),
    });
    assert.equal(rejected.reason, "invalid_action");
    assert.equal(await page.locator("#count").textContent(), "0");
    const authorization = { authorizationId: "synthetic", localExpiresAt: Date.now() + 1000 };
    await publication.trusted.publish(page, authorization);
    await assert.rejects(() => publication.trusted.publish(page, authorization));
    assert.equal(await page.locator("#count").textContent(), "1");
    await context.close();
  } finally {
    await browser.close();
  }
});
