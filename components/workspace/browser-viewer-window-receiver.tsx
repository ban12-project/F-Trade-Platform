"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { BrowserViewer } from "@/components/workspace/browser-viewer";
import {
  type ViewerWindowConnection,
  viewerWindowMessageSchema,
} from "@/lib/browser-fleet/viewer-window-contract";
export function BrowserViewerWindowReceiver() {
  const [connection, setConnection] = useState<ViewerWindowConnection | null>(null);
  const [message, setMessage] = useState("正在等待工作台的本次连接授权…");
  useEffect(() => {
    document.title = "F-Trade 浏览器接管";
    const nonce = z.uuid().safeParse(window.location.hash.slice(1));
    if (!nonce.success) {
      setMessage("请从工作台的当前任务打开接管窗口。");
      return;
    }
    window.opener = null;
    let host: MessageEventSource | null = null,
      accepted = false;
    const timer = setTimeout(
      () => setMessage("等待授权已超时，请关闭窗口并在工作台核对当前任务。"),
      35_000,
    );
    const listener = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        !event.source ||
        event.source === window ||
        accepted
      )
        return;
      const parsed = viewerWindowMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.nonce !== nonce.data) return;
      if (parsed.data.type === "ftrade-viewer-window-bind") {
        if (host && host !== event.source) return;
        host = event.source;
        (host as Window).postMessage(
          { type: "ftrade-viewer-window-ready", nonce: nonce.data },
          window.location.origin,
        );
      } else if (parsed.data.type === "ftrade-viewer-window-connection" && host === event.source) {
        accepted = true;
        clearTimeout(timer);
        setConnection(parsed.data.connection);
      }
    };
    window.addEventListener("message", listener);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", listener);
    };
  }, []);
  return (
    <div className="flex flex-col gap-4">
      {connection ? (
        <BrowserViewer origin={connection.origin} token={connection.token} />
      ) : (
        <p role="status">{message}</p>
      )}
      <Button type="button" variant="outline" onClick={() => window.close()}>
        关闭接管窗口
      </Button>
    </div>
  );
}
