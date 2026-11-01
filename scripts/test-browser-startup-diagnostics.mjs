import assert from "node:assert/strict";
import test from "node:test";
import { waitForBrowserReady } from "../ops/browser-node/egress.mjs";
import { describeBrowserLaunchFailure } from "../ops/browser-node/launch-diagnostics.mjs";
import {
  createStartupDiagnostics,
  sanitizeStartupDiagnostics,
} from "../ops/browser-node/startup-diagnostics.mjs";

test("startup stages distinguish pending options, profile checks, and Firefox launch without retaining errors", () => {
  const d = createStartupDiagnostics();
  assert.equal(d.read().status, "idle");
  d.begin();
  d.stage("launch-options");
  assert.equal(d.read().stage, "launch-options");
  d.fail(new Error("proxy credentials and private URL"));
  assert.deepEqual(d.read(), { stage: "launch-options", status: "failed", code: "unclassified" });
  d.begin();
  d.stage("profile-check");
  d.fail(new Error("native_profile_manifest_invalid"));
  assert.equal(d.read().code, "native_profile_manifest_invalid");
  d.begin();
  d.stage("firefox-launch");
  d.ready();
  const copy = d.read();
  copy.stage = "private";
  assert.deepEqual(d.read(), { stage: "firefox-launch", status: "ready", code: "unclassified" });
  d.stage("private");
  assert.equal(d.read().stage, "firefox-launch");
});

test("bounded health failure includes only the final safe startup observation and never treats it as ready", async () => {
  let calls = 0;
  const state = {
    stage: "launch-options",
    status: "starting",
    code: "private error",
    url: "secret",
  };
  await assert.rejects(
    waitForBrowserReady(
      async () => {
        calls++;
        return Response.json({
          ok: true,
          engine: "camoufox",
          browserConnected: false,
          browserRunning: false,
          startup: state,
        });
      },
      { assertActive() {}, sleep: async () => {} },
    ),
    (error) => {
      const report = describeBrowserLaunchFailure("browser-health", error);
      assert.deepEqual(report.startup, {
        stage: "launch-options",
        status: "starting",
        code: "unclassified",
      });
      assert.equal(report.code, "browser_health_browser_disconnected");
      assert.equal(JSON.stringify(report).includes("private"), false);
      assert.equal(JSON.stringify(report).includes("secret"), false);
      return true;
    },
  );
  assert.equal(calls, 60);
});

test("unreachable health cannot reuse earlier startup evidence, and invalid enums are rejected", async () => {
  let calls = 0;
  await assert.rejects(
    waitForBrowserReady(
      async () => {
        if (++calls === 60) throw Error("private transport");
        return Response.json({
          ok: true,
          engine: "camoufox",
          startup: { stage: "profile-check", status: "starting" },
        });
      },
      { assertActive() {}, sleep: async () => {} },
    ),
    (error) => {
      assert.equal(describeBrowserLaunchFailure("browser-health", error).startup, undefined);
      assert.equal(error.browserFailureCode, "browser_health_unreachable");
      return true;
    },
  );
  for (const input of [
    null,
    {},
    "private",
    { stage: "private", status: "starting" },
    { stage: "publish", status: "private" },
  ])
    assert.equal(sanitizeStartupDiagnostics(input), null);
});
