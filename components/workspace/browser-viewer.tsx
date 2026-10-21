"use client";

import { useEffect, useRef, useState } from "react";

const labels = {
  loading: "正在加载接管页面…",
  waiting: "正在等待连接授权…",
  authorizing: "正在核对连接授权…",
  connecting: "正在连接远程桌面…",
  connected: "远程桌面已连接。",
  disconnected: "远程桌面已断开，请核对当前任务后重新授权连接。",
  failed: "连接未能建立，请核对当前任务后重新授权连接。",
  timeout: "尚未确认远程连接。请核对下方画面及当前任务，再重新授权连接。",
};
type Phase = keyof typeof labels;
export function BrowserViewer({ origin, token }: { origin: string; token: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const settled = useRef(false);
  function deliverTicket() {
    frame.current?.contentWindow?.postMessage({ type: "ftrade-browser-ticket", token }, origin);
  }
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return;
      if (event.data?.type === "ftrade-browser-ready") {
        frame.current?.contentWindow?.postMessage({ type: "ftrade-browser-ticket", token }, origin);
      }
      if (event.data?.type === "ftrade-browser-status" && Object.hasOwn(labels, event.data.phase)) {
        settled.current = ["connected", "disconnected", "failed", "timeout"].includes(
          event.data.phase,
        );
        setPhase(event.data.phase);
      }
    };
    window.addEventListener("message", listener);
    // A prerendered frame can finish loading before React hydrates onLoad.
    // Re-deliver the same ticket after subscribing; the viewer admits it once.
    frame.current?.contentWindow?.postMessage({ type: "ftrade-browser-ticket", token }, origin);
    frame.current?.contentWindow?.postMessage({ type: "ftrade-browser-probe" }, origin);
    const timer = setTimeout(() => {
      if (!settled.current) setPhase("timeout");
    }, 35_000);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", listener);
    };
  }, [origin, token]);
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="text-sm text-muted-foreground">
        {labels[phase]}
      </p>
      <iframe
        ref={frame}
        src={`${origin}/viewer`}
        title="账号登录与两步验证"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin"
        loading="eager"
        onLoad={deliverTicket}
        onError={() => setPhase("failed")}
        className="h-[640px] w-full rounded border"
      />
    </div>
  );
}
