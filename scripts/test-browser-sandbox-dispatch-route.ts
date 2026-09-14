import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/browser-sandbox-dispatch/route";
import { authorizeManualSandboxStart } from "../lib/browser-fleet/sandbox-authorization";
import {
  claimBrowserSandboxDelivery,
  deliverBrowserSandboxOutbox,
  enqueueManualBrowserSandboxStart,
} from "../lib/browser-fleet/sandbox-outbox";
import type { Database, DatabaseTransaction } from "../lib/db/client";

test("delivery endpoint requires a configured exact cron credential and honors the deployment gate", async () => {
  const oldSecret = process.env.CRON_SECRET;
  const oldEnabled = process.env.BROWSER_SANDBOX_ENABLED;
  const request = (authorization?: string) =>
    new Request("https://example.invalid/api/browser-sandbox-dispatch", {
      headers: authorization ? { authorization } : {},
    });
  try {
    delete process.env.CRON_SECRET;
    process.env.BROWSER_SANDBOX_ENABLED = "1";
    assert.equal((await GET(request("Bearer undefined"))).status, 401);
    process.env.CRON_SECRET = "synthetic-dispatch-secret";
    for (const value of [undefined, "synthetic-dispatch-secret", "Bearer invalid", "Bearer é"])
      assert.equal((await GET(request(value))).status, 401);
    delete process.env.BROWSER_SANDBOX_ENABLED;
    const disabled = await GET(request("Bearer synthetic-dispatch-secret"));
    assert.equal(disabled.status, 200);
    assert.deepEqual(await disabled.json(), { delivered: 0, disabled: true });
  } finally {
    if (oldSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = oldSecret;
    if (oldEnabled === undefined) delete process.env.BROWSER_SANDBOX_ENABLED;
    else process.env.BROWSER_SANDBOX_ENABLED = oldEnabled;
  }
});

test("disabled start paths do not touch persistence or dispatch a workflow", async () => {
  const oldEnabled = process.env.BROWSER_SANDBOX_ENABLED;
  const oldSecret = process.env.CRON_SECRET;
  let reads = 0;
  let starts = 0;
  const persistence = new Proxy(
    {},
    {
      get() {
        reads++;
        throw new Error("persistence_accessed");
      },
    },
  );
  const database = persistence as Database;
  const transaction = persistence as DatabaseTransaction;
  const start = async () => {
    starts++;
    throw new Error("workflow_started");
  };
  try {
    process.env.CRON_SECRET = "synthetic-gate-secret";
    for (const value of [undefined, "0", "", "false", "true", "01", "1 "]) {
      if (value === undefined) delete process.env.BROWSER_SANDBOX_ENABLED;
      else process.env.BROWSER_SANDBOX_ENABLED = value;
      assert.equal(await authorizeManualSandboxStart(transaction, "node", "operation"), null);
      assert.equal(await enqueueManualBrowserSandboxStart(transaction, "node"), null);
      assert.equal(await claimBrowserSandboxDelivery(database), null);
      assert.deepEqual(await deliverBrowserSandboxOutbox(database, start), { delivered: 0 });
      const response = await GET(
        new Request("https://example.invalid/api/browser-sandbox-dispatch", {
          headers: { authorization: "Bearer synthetic-gate-secret" },
        }),
      );
      assert.deepEqual(await response.json(), { delivered: 0, disabled: true });
    }
    assert.equal(reads, 0, "disabled paths stop before database access");
    assert.equal(starts, 0, "disabled paths never dispatch a workflow");
    // Positive control ensures the sentinel catches an enabled persistence path.
    process.env.BROWSER_SANDBOX_ENABLED = "1";
    await assert.rejects(claimBrowserSandboxDelivery(database), /persistence_accessed/);
    assert.equal(reads, 1);
    assert.equal(starts, 0);
  } finally {
    if (oldEnabled === undefined) delete process.env.BROWSER_SANDBOX_ENABLED;
    else process.env.BROWSER_SANDBOX_ENABLED = oldEnabled;
    if (oldSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = oldSecret;
  }
});
