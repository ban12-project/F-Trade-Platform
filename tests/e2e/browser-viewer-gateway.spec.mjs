import { once } from "node:events";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { createGateway } from "../../ops/browser-node/gateway.mjs";

test("embedded viewer loads the actual gateway document and CSP before one-use admission", async ({
  page,
  baseURL,
}) => {
  // Only the desktop transport is synthetic. HTML, headers, viewer module,
  // admission and capability-gated module delivery use the production gateway.
  const desktop = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/javascript");
    response.end(`export default class RFB extends EventTarget {
      constructor(screen) {
        super();
        const input = document.createElement('input');
        input.setAttribute('aria-label', 'Synthetic desktop keyboard');
        screen.append(input);
        setTimeout(() => this.dispatchEvent(new Event('connect')), 0);
      }
      disconnect() { this.dispatchEvent(new Event('disconnect')); }
    }`);
  });
  desktop.listen(0, "127.0.0.1");
  await once(desktop, "listening");
  const slot = {
    run: { id: "synthetic-embedded-viewer" },
    ready: true,
    stopping: false,
    expiresAt: Date.now() + 60_000,
    gatewayOrigin: "http://127.0.0.1:9427",
    vncPort: desktop.address().port,
    vncPassword: "synthetic-not-a-secret",
  };
  let admissions = 0;
  const gateway = createGateway({
    appOrigin: baseURL,
    slots: new Map([[slot.run.id, slot]]),
    port: 9427,
    nodeCall: async (operation, { ticket }) => {
      if (operation !== "admit" || ticket !== "isolated-viewer-fixture" || admissions)
        throw new Error("denied");
      admissions++;
      return { runId: slot.run.id };
    },
  });
  try {
    await once(gateway.server, "listening");
    const documentResponse = page.waitForResponse(
      (response) => response.url() === `${slot.gatewayOrigin}/viewer`,
    );
    await page.goto("/testing/browser-viewer");
    const response = await documentResponse;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-security-policy"]).toContain(
      `frame-ancestors ${baseURL}; sandbox allow-scripts allow-same-origin`,
    );
    await expect(page.getByRole("status")).toHaveText("远程桌面已连接。");
    const frame = page.frameLocator('iframe[title="账号登录与两步验证"]');
    await frame.getByRole("textbox", { name: "Synthetic desktop keyboard" }).fill("fixture");
    await expect(frame.getByRole("textbox")).toHaveValue("fixture");
    expect(admissions).toBe(1);
    const replay = await page.request.post(`${slot.gatewayOrigin}/admit`, {
      headers: { Origin: slot.gatewayOrigin },
      data: { ticket: "isolated-viewer-fixture" },
    });
    expect(replay.status()).toBe(403);
  } finally {
    gateway.close();
    gateway.server.closeAllConnections();
    desktop.closeAllConnections();
    await new Promise((resolve) => desktop.close(resolve));
  }
});
