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
  const desktop = createServer((request, response) => {
    response.setHeader("Content-Type", "text/javascript");
    if (request.url.endsWith("/keysym.js")) {
      response.end("export default {XK_F12:65481,XK_Control_L:65507,XK_Shift_L:65505}");
      return;
    }
    response.end(`export default class RFB extends EventTarget {
      constructor(screen) {
        super();
        const input = document.createElement('textarea');
        input.setAttribute('aria-label', 'Synthetic desktop keyboard');
        screen.append(input);
        this.input = input;
        window.sentKeys = [];
        setTimeout(() => this.dispatchEvent(new Event('connect')), 0);
      }
      focus() { this.input.focus(); }
      blur() { this.input.blur(); }
      clipboardPasteFrom(text) { this.transfer = text; }
      sendKey(key, code, down) {
        window.sentKeys.push([key, down ?? null]);
        if (down !== undefined) return;
        if (key === 118) this.input.value += this.transfer;
        if (key === 99 || key === 120) this.dispatchEvent(new CustomEvent('clipboard', {detail:{text:this.input.value}}));
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
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const remote = frame.getByRole("textbox", { name: "Synthetic desktop keyboard" });
    const clipboardText = "中文\n第二行";
    await page.evaluate((text) => navigator.clipboard.writeText(text), clipboardText);
    await remote.press("Control+v");
    await expect(remote).toHaveValue(`fixture${clipboardText}`);
    await remote.press("Meta+v");
    await expect(remote).toHaveValue(`fixture${clipboardText}${clipboardText}`);
    await remote.press("Meta+c");
    await expect(frame.locator("#feedback")).toHaveText("已复制到本机。");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      await remote.inputValue(),
    );
    await frame.locator("summary").click();
    await frame.getByLabel("Ctrl", { exact: true }).check();
    await frame.getByLabel("Shift", { exact: true }).check();
    await frame.locator("#key").fill("F12");
    await frame.locator("#send").click();
    expect(await remote.evaluate(() => window.sentKeys.slice(-5))).toEqual([
      [65507, true],
      [65505, true],
      [65481, null],
      [65505, false],
      [65507, false],
    ]);
    await remote.evaluate(() =>
      Object.defineProperty(navigator, "platform", { value: "MacIntel" }),
    );
    await remote.press("Meta+Shift+z");
    expect(await remote.evaluate(() => window.sentKeys.slice(-5))).toEqual([
      [65507, true],
      [65505, true],
      [122, null],
      [65505, false],
      [65507, false],
    ]);
    const saved = await remote.inputValue();
    await remote.fill("");
    await remote.press("Control+c");
    await expect(frame.locator("#feedback")).toHaveText("未收到新的远端选区。");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(saved);
    // Deny programmatic clipboard access to the embedded viewer only.
    await remote.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: {} }));
    await remote.press("Meta+v");
    const manual = frame.locator("#clip");
    await expect(manual).toBeFocused();
    await manual.fill("手动中转");
    await frame.locator("#paste").click();
    await expect(remote).toHaveValue("手动中转");
    await remote.press("Control+x");
    await expect(manual).toHaveValue("手动中转");
    await expect(manual).toBeFocused();
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
