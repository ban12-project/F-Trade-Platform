const appOrigin = "__APP_ORIGIN__";
const status = document.getElementById("status");
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
  window.parent.postMessage({ type: "ftrade-browser-status", phase }, appOrigin);
}
function update(next) {
  phase = next;
  status.textContent = messages[next];
  report();
}
function ready() {
  window.parent.postMessage({ type: "ftrade-browser-ready" }, appOrigin);
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
  if (event.source !== window.parent || event.origin !== appOrigin || finished) return;
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
