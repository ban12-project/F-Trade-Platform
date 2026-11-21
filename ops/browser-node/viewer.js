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
let closeInput;
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
  closeInput?.();
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
    const transport = new URL(websocket, location.href);
    transport.protocol =
      location.protocol === "http:" && location.hostname === "127.0.0.1" ? "ws:" : "wss:";
    rfb = new RFB(document.getElementById("screen"), transport.href, {
      credentials: { password },
    });
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.addEventListener("connect", () => {
      if (finished) return;
      clearTimeout(deadline);
      update("connected");
      closeInput = enableInput(rfb, module);
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

// Physical keyboard layout and ordinary key events are handled by noVNC.
// The picker also works for shortcuts consumed by the operator's browser or OS.
function enableInput(desktop, modulePath) {
  const el = (id) => document.getElementById(id);
  const tools = el("tools");
  const screen = el("screen");
  const clip = el("clip");
  const feedback = el("feedback");
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let symbols;
  let pendingCopy;
  let revision = 0;
  tools.hidden = false;
  function invalidate() {
    revision++;
    pendingCopy?.(null);
  }
  const heldModifiers = new Map();
  // Let noVNC translate each physical modifier using its own host/layout mapping.
  // In particular, a Mac Command key can already be down when the C arrives.
  const capture = { ...options, capture: true };
  screen.addEventListener(
    "keydown",
    (event) => {
      if (event.isTrusted && ["Control", "Meta", "Alt", "Shift", "AltGraph"].includes(event.key))
        heldModifiers.set(event.code, event);
    },
    capture,
  );
  screen.addEventListener(
    "keyup",
    (event) => {
      if (event.isTrusted) heldModifiers.delete(event.code);
    },
    capture,
  );
  function replayModifiers(type) {
    for (const event of heldModifiers.values())
      event.target.dispatchEvent(new KeyboardEvent(type, event));
  }
  screen.addEventListener(
    "focusout",
    () => {
      replayModifiers("keyup");
      heldModifiers.clear();
    },
    options,
  );
  function chord(modifiers, key) {
    desktop.focus();
    replayModifiers("keyup");
    for (const modifier of modifiers) desktop.sendKey(modifier, null, true);
    try {
      desktop.sendKey(key, null);
    } finally {
      for (const modifier of modifiers.toReversed()) desktop.sendKey(modifier, null, false);
      replayModifiers("keydown");
    }
  }
  tools.addEventListener(
    "toggle",
    async () => {
      if (!tools.open || symbols) return;
      try {
        const path = new URL("./input/keysym.js", new URL(modulePath, location.href));
        const { default: table } = await import(path.href);
        if (finished || symbols) return;
        symbols = new Map();
        for (const [name, value] of Object.entries(table)) {
          const label = name.replace(/^XK_/, "").replace(/^XF86XK_/, "XF86");
          if (Number.isInteger(value)) symbols.set(label, value);
        }
        for (const [label, name] of Object.entries({
          Enter: "Return",
          Backspace: "BackSpace",
          PageUp: "Prior",
          PageDown: "Next",
          ArrowUp: "Up",
          ArrowDown: "Down",
          ArrowLeft: "Left",
          ArrowRight: "Right",
          PrintScreen: "Print",
          Space: "space",
        })) {
          if (symbols.has(name)) symbols.set(label, symbols.get(name));
        }
        const list = el("key-list");
        for (const label of symbols.keys()) list.append(new Option(label, label));
      } catch {
        feedback.textContent = "按键列表加载失败。可重新展开重试。";
      }
    },
    options,
  );
  el("send").addEventListener(
    "click",
    () => {
      const name = el("key").value;
      let key = symbols?.get(name);
      // X11 reserves the top three bits; accept display-supported vendor keysyms too.
      if (/^0x[\da-f]{1,8}$/i.test(name) && Number(name) <= 0x1fffffff) key = Number(name);
      if (key === undefined && [...name].length === 1) {
        const code = name.codePointAt(0);
        key = code <= 255 ? code : 0x01000000 + code;
      }
      if (!symbols || !key) {
        feedback.textContent = "请选择按键、输入单个字符或十六进制 X11 键值。";
        return;
      }
      const modifiers = [...tools.querySelectorAll("input:checked")].map((input) =>
        symbols.get(input.value),
      );
      if (modifiers.includes(undefined)) return;
      invalidate();
      chord(modifiers, key);
      feedback.textContent = "按键已发送。";
    },
    options,
  );
  function manual(message) {
    tools.open = true;
    feedback.textContent = message;
    clip.focus();
    clip.select();
  }
  function paste(text) {
    if (!text) return;
    // TigerVNC and the viewer share a 256 KiB clipboard limit, including CRLF.
    if (
      new TextEncoder().encode(text.replace(/\r?\n/g, "\r\n")).length + 1 > 262144 ||
      text.includes("\0")
    ) {
      feedback.textContent = "请分段粘贴纯文本，每段小于 256 KiB 且不含空字符。";
      return;
    }
    desktop.clipboardPasteFrom(text);
    chord([0xffe3], 0x76);
    clip.value = "";
    feedback.textContent = "";
  }
  async function pasteLocal() {
    invalidate();
    const current = revision;
    try {
      const text = await navigator.clipboard.readText();
      if (current === revision && screen.contains(document.activeElement)) paste(text);
    } catch {
      if (current === revision) manual("请在文本框中粘贴，再点击「粘贴文本到远端」。");
    }
  }
  el("paste").addEventListener(
    "click",
    () => {
      invalidate();
      paste(clip.value);
    },
    options,
  );
  desktop.addEventListener("clipboard", (event) => pendingCopy?.(event.detail.text), options);
  async function copy(key) {
    invalidate();
    const current = revision;
    clip.value = "";
    let timer;
    const result = new Promise((resolve) => {
      pendingCopy = (text) => {
        clearTimeout(timer);
        pendingCopy = null;
        resolve(text);
      };
      timer = setTimeout(() => pendingCopy?.(null), 3000);
    });
    // Start the write during the user's gesture. The remote selection arrives later.
    const write = (async () => {
      if (typeof ClipboardItem === "undefined") {
        const text = await result;
        if (!text || current !== revision) return false;
        await navigator.clipboard.writeText(text);
      } else {
        const blob = result.then((text) => {
          if (!text || current !== revision) throw new Error("selection_unavailable");
          return new Blob([text], { type: "text/plain" });
        });
        void blob.catch(() => {});
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      }
      return true;
    })().catch(() => false);
    chord([0xffe3], key);
    const text = await result;
    const written = await write;
    if (current !== revision) return;
    if (!text) feedback.textContent = "未收到新的远端选区。";
    else if (written) feedback.textContent = "已复制到本机。";
    else {
      clip.value = text;
      manual("请从文本框复制到本机。");
    }
  }
  el("copy").addEventListener("click", () => void copy(0x63), options);
  screen.addEventListener(
    "keydown",
    (event) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.isComposing) return;
      const key = event.key.toLowerCase();
      const pasteKey = key === "v";
      const copyKey = !event.shiftKey && (key === "c" || key === "x");
      // Linux Camoufox expects Control for these common macOS Command shortcuts.
      const macShortcut =
        event.metaKey &&
        !event.ctrlKey &&
        /Mac/.test(navigator.platform) &&
        /^[azfgklsprtonwdb0-9=+-]$/.test(key);
      if (!pasteKey && !copyKey && !macShortcut) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (pasteKey) void pasteLocal();
      else if (copyKey) void copy(key.codePointAt(0));
      else chord(event.shiftKey ? [0xffe3, 0xffe1] : [0xffe3], key.codePointAt(0));
    },
    { ...options, capture: true },
  );
  window.addEventListener(
    "blur",
    () => {
      heldModifiers.clear();
      invalidate();
    },
    options,
  );
  return () => {
    listeners.abort();
    invalidate();
    tools.hidden = true;
    clip.value = "";
    feedback.textContent = "";
  };
}
