import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { createConnectionDiagnostics } from "../../ops/browser-node/diagnostics-plugin/index.js";

test("real browser reports a failed gateway socket without retaining request or error content", async ({
  browser,
}) => {
  // This local proxy refuses every CONNECT. No Facebook request leaves the test host.
  const proxy = createServer();
  proxy.on("connect", (_request, socket) => {
    socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("test_proxy_missing");
  const context = await browser.newContext({
    proxy: { server: `http://127.0.0.1:${address.port}` },
  });
  try {
    const page = await context.newPage();
    const accountId = randomUUID(),
      runId = randomUUID();
    const sessions = new Map([
      [accountId, { tabGroups: new Map([[runId, new Map([["tab", { page }]])]]) }],
    ]);
    const diagnostics = createConnectionDiagnostics({
      sessions,
      accountId,
      runId,
      leaseDeadline: () => Date.now() + 60000,
    });
    diagnostics.attach({ userId: accountId, page });
    await page.evaluate(() => {
      const socket = new WebSocket(
        "wss://gateway.facebook.com/ws/realtime?synthetic_secret=never-retain",
      );
      socket.addEventListener("error", () => {});
    });
    const query = { userId: accountId, runId, tabId: "tab" };
    await expect
      .poll(() => diagnostics.read(query))
      .toEqual({
        version: 1,
        created: 1,
        errors: 1,
        closed: 1,
        sentFrames: 0,
        receivedFrames: 0,
        dropped: 0,
      });
    await page.close();
    expect(diagnostics.read(query)).toBeNull();
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) =>
      proxy.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
