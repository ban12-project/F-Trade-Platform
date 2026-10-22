const appOrigin = "__APP_ORIGIN__";
const status = document.getElementById("status");
const standalone = window.parent === window;
const nonce = standalone ? location.hash.slice(1) : null;
const validNonce =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce ?? "");
let host = standalone ? null : window.parent;
// The gateway never retains an opener. A platform probe binds the exact source
// window; the nonce alone is not an admission capability.
if (standalone) window.opener = null;
let admitted = false;
let finished = false;
let rfb;
let phase = "waiting";
const messages = {
  waiting: "正在等待平台授权…",
  authorizing: "正在核对连接授权…",
  connecting: "授权已核对，正在连接远程桌面…",
  connected: "已连接。请核对代理出口与目标账号后操作。",
  disconnected: "连接已断开。请在平台重新授权连接；资源已释放时需重新排队。",
  failed: "连接未获授权或未能建立，请在平台核对任务后重新连接。",
  timeout: "连接超时。请在平台核对任务后重新连接；本次不会自动重试。",
};
function report() {
  host?.postMessage(
    { type: "ftrade-browser-status", phase, ...(standalone ? { nonce } : {}) },
    appOrigin,
  );
}
function update(next) {
  phase = next;
  status.textContent = messages[next];
  report();
}
function ready() {
  host?.postMessage({ type: "ftrade-browser-ready", ...(standalone ? { nonce } : {}) }, appOrigin);
}
function finish(next) {
  if (finished) return;
  finished = true;
  clearInterval(readiness);
  clearTimeout(deadline);
  update(next);
  rfb?.disconnect();
}
// The parent may hydrate after this module. Readiness can repeat; admission cannot.
const readiness = setInterval(() => {
  if (!admitted) ready();
}, 500);
const deadline = setTimeout(() => finish("timeout"), 30_000);
window.addEventListener("message", async (event) => {
  if (event.origin !== appOrigin || finished) return;
  if (standalone) {
    if (!validNonce || event.data?.nonce !== nonce || !event.source || event.source === window)
      return;
    if (!host && event.data?.type === "ftrade-browser-probe") host = event.source;
  }
  if (!host || event.source !== host) return;
  if (event.data?.type === "ftrade-browser-probe") {
    report();
    if (!admitted) ready();
    return;
  }
  if (
    admitted ||
    event.data?.type !== "ftrade-browser-ticket" ||
    typeof event.data.token !== "string"
  )
    return;
  admitted = true;
  clearInterval(readiness);
  update("authorizing");
  try {
    const response = await fetch("/admit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: event.data.token }),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("denied");
    const { module, websocket, password } = await response.json();
    const { default: RFB } = await import(module);
    if (finished) return;
    update("connecting");
    rfb = new RFB(document.getElementById("screen"), `wss://${location.host}${websocket}`, {
      credentials: { password },
    });
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.addEventListener("connect", () => {
      if (finished) return;
      clearTimeout(deadline);
      update("connected");
    });
    rfb.addEventListener("disconnect", () => finish("disconnected"));
    rfb.addEventListener("securityfailure", () => finish("failed"));
  } catch {
    finish("failed");
  }
});
window.addEventListener("pagehide", () => finish("disconnected"), { once: true });
update("waiting");
ready();
