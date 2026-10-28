// Offline synthetic integration. This never validates an external proxy or an
// actual account. Production startup has no switch to disable proxy/GeoIP.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { createNativeProfileRuntime, initializeNativeProfile } from "/app/native-profile.mjs";
import { startDisplay } from "/app/official-runtime/display.mjs";
import { Camoufox, launchOptions } from "/app/official-runtime/node_modules/camoufox/dist/index.js";
import { createRuntimeService } from "/app/official-runtime/service.mjs";
import { createGateway } from "/project/browser-node/gateway.mjs";
import { configureLoginFixture, verifyLoginContracts } from "./login.mjs";
import { verifyPublicationContracts } from "./publication.mjs";
import { verifySocialContracts } from "./social.mjs";

const mode = process.env.FIXTURE_MODE;
assert.ok(["write", "read", "lease"].includes(mode));
const accountId = process.env.FTRADE_PROFILE_ACCOUNT_ID;
const runId = process.env.FTRADE_RUNTIME_RUN_ID;
const key = process.env.CAMOFOX_ACCESS_KEY;
const origin = "https://fixture.browser.test";
const renew = () => writeFileSync("/tmp/ftrade-lease", String(Date.now() + 90000), { mode: 0o600 });
renew();
const pulse = mode === "lease" ? undefined : setInterval(renew, 10000);
const leaseDeadline = () => Number(readFileSync("/tmp/ftrade-lease", "utf8"));
let display, runtime, server, gateway, viewerBrowser;
const shutdownStage = (stage) => {
  if (mode === "lease") writeFileSync("/data/synthetic-shutdown.json", JSON.stringify({ stage }));
};
async function close() {
  shutdownStage("closing");
  clearInterval(pulse);
  gateway?.close();
  await viewerBrowser?.close();
  if (server) {
    server.closeAllConnections();
    server.close();
  }
  shutdownStage("context-closing");
  await runtime?.close();
  shutdownStage("context-closed");
  await display?.close();
  shutdownStage("display-closed");
}
process.once("SIGTERM", () => {
  void close()
    .then(() => process.exit(0))
    .catch((error) => {
      shutdownStage(`close-failed: ${error.stack}`);
      process.exit(1);
    });
});
try {
  if (mode === "write")
    await initializeNativeProfile({
      root: "/data",
      accountId,
      nodeId: process.env.FTRADE_PROFILE_NODE_ID,
      source: "empty",
    });
  display = await startDisplay();
  const native = createNativeProfileRuntime({
    root: "/data",
    leaseDeadline,
    firefox: {
      launchPersistentContext: (profile, options) =>
        Camoufox({
          persistent_context: true,
          from_options: {
            ...options,
            user_data_dir: profile,
            // The service owns shutdown ordering and flushes the native context
            // before closing its display. Avoid Playwright's competing handlers.
            handleSIGTERM: false,
            handleSIGINT: false,
            handleSIGHUP: false,
          },
        }),
    },
  });
  const options = await launchOptions({
    os: "linux",
    headless: false,
    virtual_display: display.display,
    executable_path: "/root/.cache/camoufox/camoufox-bin",
    window: [1400, 860],
    exclude_addons: ["UBO"],
  });
  let context;
  const launcher = {
    assertAccount: native.assertAccount,
    ensureBrowser: (timeout) => native.ensureBrowser(() => native.launch(options), timeout),
    async contextFor(id) {
      context = await native.contextFor(id);
      await context.route(`${origin}/**`, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><title>synthetic runtime</title><input id="remote-input" autofocus><button id="click-proof" onclick="this.textContent='clicked'">click</button><div contenteditable="true" id="text"></div><input type="file" id="file">`,
        }),
      );
      return context;
    },
  };
  if (mode === "write") configureLoginFixture(accountId, runId);
  runtime = createRuntimeService({
    launcher,
    accountId,
    runId,
    accessKey: key,
    leaseDeadline,
    viewer: display,
    registerIntegrations: mode === "write",
    validateUrl: (value) => {
      const u = new URL(value);
      assert.ok([origin, "https://www.facebook.com"].includes(u.origin));
      return u.href;
    },
  });
  server = runtime.app.listen(9377, "127.0.0.1");
  await once(server, "listening");
  await runtime.start();
  await display.startViewer();
  async function request(path, body, expected = 200) {
    const response = await fetch(`http://127.0.0.1:9377${path}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, expected, `HTTP status at ${path.split("?")[0]}`);
    return response.json();
  }
  assert.equal((await request("/health")).browserConnected, true);
  assert.equal((await request("/vnc/status")).running, true);
  await request("/tabs", { userId: runId, sessionKey: runId, url: `${origin}/` }, 403);
  const tab = await request("/tabs", {
    userId: accountId,
    sessionKey: runId,
    url: `${origin}/`,
    trace: false,
  });
  const evaluate = async (expression) =>
    (await request(`/tabs/${tab.tabId}/evaluate`, { userId: accountId, expression })).result;
  // Scripts run in the actual page world, so a CryptoKey is not serialized
  // through the automation boundary; only the result marker is observed.
  await context
    .pages()
    .at(-1)
    .addScriptTag({
      content: `
    globalThis.fixtureStorage = async (mode) => {
      const db = await new Promise((ok,no)=>{const r=indexedDB.open('official-runtime-fixture',1);r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
      if(mode==='write'){
        const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
        const iv=crypto.getRandomValues(new Uint8Array(12));
        const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new Uint8Array([7,4,1]));
        await new Promise((ok,no)=>{const t=db.transaction('keys','readwrite');t.objectStore('keys').put({key,iv,ciphertext},'saved');t.oncomplete=ok;t.onerror=()=>no(t.error)});
        localStorage.setItem('continuity','preserved');document.cookie='fixture=preserved; Max-Age=86400; Secure; SameSite=Strict';
      }else{
        if(localStorage.getItem('continuity')!=='preserved'||!document.cookie.includes('fixture=preserved'))throw Error('storage_lost');
        const saved=await new Promise((ok,no)=>{const r=db.transaction('keys').objectStore('keys').get('saved');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
        if(!saved||saved.key.extractable)throw Error('key_lost');
        const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv},saved.key,saved.ciphertext);
        if(new Uint8Array(plain).join(',')!=='7,4,1')throw Error('key_changed');
      }
      db.close();document.documentElement.dataset.storage='passed';
    };
    fixtureStorage(${JSON.stringify(mode === "write" ? "write" : "read")}).catch(()=>document.documentElement.dataset.storage='failed');
  `,
    });
  for (let i = 0; i < 50; i++) {
    const result = await evaluate("document.documentElement.dataset.storage");
    assert.notEqual(result, "failed");
    if (result === "passed") break;
    assert.notEqual(i, 49, "persistent storage fixture timed out");
    await sleep(100);
  }
  if (process.env.EXPECT_SHUTDOWN === "1")
    assert.equal(await evaluate("localStorage.getItem('shutdownMarker')"), "lease-expiry");
  const identity = await evaluate(
    `(() => {
      const gl=document.createElement('canvas').getContext('webgl');
      const debug=gl?.getExtension('WEBGL_debug_renderer_info');
      return {ua:navigator.userAgent,language:navigator.language,languages:[...navigator.languages],
        timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,width:innerWidth,height:innerHeight,
        screen:{width:screen.width,height:screen.height,colorDepth:screen.colorDepth,pixelRatio:devicePixelRatio},
        webgl:gl?{vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),
          unmaskedVendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):null,
          unmaskedRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null}:null,
        rtc:{peerConnection:typeof RTCPeerConnection,mediaDevices:typeof navigator.mediaDevices}}
    })()`,
  );
  assert.ok(identity.width <= 1440 && identity.height <= 900);
  if (mode === "write")
    writeFileSync("/data/synthetic-identity.json", JSON.stringify(identity), { mode: 0o600 });
  else {
    const previous = JSON.parse(readFileSync("/data/synthetic-identity.json", "utf8"));
    console.log(
      JSON.stringify({
        identityChangedFields: Object.keys(identity).filter(
          (k) => JSON.stringify(identity[k]) !== JSON.stringify(previous[k]),
        ),
      }),
    );
  }
  if (mode === "write") {
    for (const [mode, value] of [
      ["fill", ""],
      ["keyboard", "SYNTHETIC 中文🙂"],
    ]) {
      await request(`/tabs/${tab.tabId}/type`, {
        userId: accountId,
        selector: "#text",
        mode,
        text: value,
        submit: false,
        pressEnter: false,
      });
    }
    assert.equal(await evaluate("document.querySelector('#text').textContent"), "SYNTHETIC 中文🙂");
    const buffer = readFileSync("/project-fixtures/browser-media/h264-blue.mp4");
    const sha = createHash("sha256").update(buffer).digest("hex");
    mkdirSync("/tmp/ftrade-uploads", { mode: 0o700 });
    const path = `/tmp/ftrade-uploads/${sha}.mp4`;
    writeFileSync(path, buffer, { mode: 0o600, flag: "wx" });
    const upload = await request(`/tabs/${tab.tabId}/upload`, {
      userId: accountId,
      inputSelector: "#file",
      path,
    });
    assert.deepEqual(upload.attached, [path]);
    assert.equal(await evaluate("document.querySelector('#file').files.length"), 1);
    await request("/act", {
      userId: accountId,
      targetId: tab.tabId,
      kind: "hover",
      selector: "#click-proof",
    });
    await verifySocialContracts({ context, accountId, runId, accessKey: key });
    await verifyLoginContracts({ context, accountId, runId, accessKey: key });
    await verifyPublicationContracts({ context, accountId, runId, accessKey: key });
  }
  if (mode === "lease") {
    await evaluate("localStorage.setItem('shutdownMarker', 'lease-expiry')");
    writeFileSync("/tmp/official-fixture-ready", "ready");
    console.log("PASS synthetic service ready for outer watchdog expiry");
  } else {
    // Real noVNC module, RFB transport and the unchanged ticket gateway. This
    // local HTTP fixture does not replace the deployed HTTPS viewer UI gate.
    const slot = {
      run: { id: runId },
      ready: true,
      stopping: false,
      expiresAt: Date.now() + 90000,
      gatewayOrigin: "http://127.0.0.1:9400",
      vncPort: 6080,
      vncPassword: process.env.VNC_PASSWORD,
    };
    const tickets = new Set(["synthetic-ticket"]);
    gateway = createGateway({
      appOrigin: slot.gatewayOrigin,
      slots: new Map([[runId, slot]]),
      nodeCall: async (op, input) => {
        assert.equal(op, "admit");
        assert.ok(tickets.delete(input.ticket));
        return { runId };
      },
    });
    if (!gateway.server.listening) await once(gateway.server, "listening");
    const response = await fetch(`${slot.gatewayOrigin}/admit`, {
      method: "POST",
      headers: { origin: slot.gatewayOrigin, "content-type": "application/json" },
      body: JSON.stringify({ ticket: "synthetic-ticket" }),
    });
    assert.equal(response.status, 200);
    const admission = await response.json();
    const replay = await fetch(`${slot.gatewayOrigin}/admit`, {
      method: "POST",
      headers: { origin: slot.gatewayOrigin, "content-type": "application/json" },
      body: JSON.stringify({ ticket: "synthetic-ticket" }),
    });
    assert.equal(replay.status, 403);
    const viewOptions = await launchOptions({
      os: "linux",
      headless: true,
      executable_path: "/root/.cache/camoufox/camoufox-bin",
      exclude_addons: ["UBO"],
    });
    viewerBrowser = await Camoufox({ from_options: viewOptions });
    const viewer = await viewerBrowser.newPage();
    await viewer.route(`${slot.gatewayOrigin}/fixture`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<div id="screen" style="width:1440px;height:900px"></div>',
      }),
    );
    await viewer.goto(`${slot.gatewayOrigin}/fixture`);
    await viewer.addScriptTag({
      type: "module",
      content: `
      import RFB from ${JSON.stringify(admission.module)};
      const a=${JSON.stringify(admission)};
      const rfb=new RFB(document.querySelector('#screen'),'ws://'+location.host+a.websocket,{credentials:{password:a.password}});
      rfb.addEventListener('connect',()=>document.documentElement.dataset.connected='yes');
      rfb.addEventListener('disconnect',()=>document.documentElement.dataset.disconnected='yes');
    `,
    });
    await viewer.waitForFunction(
      () => document.documentElement.dataset.connected === "yes",
      undefined,
      { timeout: 15000 },
    );
    const remote = context.pages().at(-1);
    await remote.bringToFront();
    const input = await remote.locator("#remote-input").boundingBox();
    const offset = await remote.evaluate(() => ({ x: mozInnerScreenX, y: mozInnerScreenY }));
    const canvas = await viewer.locator("canvas").boundingBox();
    assert.ok(input && canvas);
    // Click and type in the actual noVNC canvas. Playwright never types in the
    // remote input itself; only the RFB/X11 path can change its value.
    await viewer.mouse.click(
      canvas.x + ((offset.x + input.x + 10) * canvas.width) / 1440,
      canvas.y + ((offset.y + input.y + input.height / 2) * canvas.height) / 900,
    );
    await viewer.keyboard.press("a");
    try {
      await remote.waitForFunction(
        () => document.querySelector("#remote-input").value === "a",
        undefined,
        { timeout: 10000 },
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          syntheticInputDiagnostics: await remote.evaluate(() => ({
            value: document.querySelector("#remote-input").value,
            focus: document.hasFocus(),
            active: document.activeElement?.id,
          })),
          offset,
          input,
          canvas,
        }),
      );
      throw error;
    }
    slot.expiresAt = Date.now() - 1;
    await viewer.waitForFunction(
      () => document.documentElement.dataset.disconnected === "yes",
      undefined,
      { timeout: 5000 },
    );
    const asset = await fetch(`${slot.gatewayOrigin}${admission.module}`);
    assert.equal(asset.status, 403);
    writeFileSync("/tmp/ftrade-lease", String(Date.now() - 1));
    await request("/health", undefined, 403);
    console.log(
      JSON.stringify({
        mode,
        nativeStorage: "passed",
        nonextractableKey: "passed",
        apiIsolation: "passed",
        vncKeyboard: "passed",
        ticketReplayRejected: true,
        expiredTunnelClosed: true,
      }),
    );
    await close();
  }
} catch (error) {
  console.error(String(error.stack));
  await close();
  process.exitCode = 1;
}
