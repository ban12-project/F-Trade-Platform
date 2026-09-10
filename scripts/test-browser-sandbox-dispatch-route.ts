import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/browser-sandbox-dispatch/route";

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
