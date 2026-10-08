import assert from "node:assert/strict";
import { mock } from "node:test";

let calls = 0,
  fail = false;
mock.module(new URL("../lib/video/retention-cleanup.ts", import.meta.url).href, {
  exports: {
    cleanupExpiredVideoObjects: async () => {
      calls++;
      if (fail) throw new Error("SYNTHETIC private path and credential");
      return { videosPurged: 0, objectsPurged: 0, protected: 0, failed: 0 };
    },
  },
});
const { GET } = await import("../app/api/video-retention/route");
const saved = process.env.CRON_SECRET;
try {
  for (const secret of [undefined, "synthetic-cron-secret"]) {
    if (secret) process.env.CRON_SECRET = secret;
    else delete process.env.CRON_SECRET;
    for (const header of ["", "Bearer wrong", "Bearer synthetic-cron-secreT", "Bearer éé"]) {
      const response = await GET(
        new Request(
          "https://example.invalid/api/video-retention?path=source-factory/original.pdf",
          { headers: { authorization: header } },
        ),
      );
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  }
  assert.equal(calls, 0);
  const request = () =>
    new Request("https://example.invalid/api/video-retention", {
      headers: { authorization: "Bearer synthetic-cron-secret" },
    });
  assert.equal((await GET(request())).status, 200);
  assert.equal(calls, 1);
  fail = true;
  const error = await GET(request());
  assert.equal(error.status, 503);
  assert.deepEqual(await error.json(), { error: "retention_unavailable" });
  console.log(
    "PASS retention scheduler fails closed, ignores client paths and conceals private errors",
  );
} finally {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
}
