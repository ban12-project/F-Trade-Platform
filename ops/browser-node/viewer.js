const appOrigin = "__APP_ORIGIN__";
const status = document.getElementById("status");
let admitted = false;
window.addEventListener("message", async (event) => {
  if (
    admitted ||
    event.source !== window.parent ||
    event.origin !== appOrigin ||
    event.data?.type !== "ftrade-browser-ticket" ||
    typeof event.data.token !== "string"
  )
    return;
  admitted = true;
  try {
    const response = await fetch("/admit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: event.data.token }),
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("denied");
    const { module, websocket, password } = await response.json();
    const { default: RFB } = await import(module);
    const rfb = new RFB(document.getElementById("screen"), `wss://${location.host}${websocket}`, {
      credentials: { password },
    });
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.addEventListener("connect", () => {
      status.textContent = "已连接。请核对代理出口与目标账号后操作。";
    });
    rfb.addEventListener("disconnect", () => {
      status.textContent = "连接已结束。需要再次操作时请重新排队。";
    });
  } catch {
    status.textContent = "连接未获授权或已过期，请回到平台重新排队。";
  }
});
window.parent.postMessage({ type: "ftrade-browser-ready" }, appOrigin);
