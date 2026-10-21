"use client";
import { useEffect, useEffectEvent, useRef } from "react";
import {
  type ViewerWindowConnection,
  viewerWindowMessageSchema,
} from "@/lib/browser-fleet/viewer-window-contract";
export type ViewerWindow = { window: Window; nonce: string; path: string };
export function openViewerWindow(
  path: "/browser-viewer" | "/testing/browser-viewer/window" = "/browser-viewer",
): ViewerWindow | null {
  const nonce = crypto.randomUUID();
  const url = new URL(path, window.location.href);
  url.hash = nonce;
  const popup = window.open(url.href, "_blank", "popup,width=1440,height=960");
  if (!popup) return null;
  popup.opener = null;
  return { window: popup, nonce, path };
}
export function viewerWindowIsOpen(popup: ViewerWindow) {
  try {
    if (popup.window.closed) return false;
    const href = popup.window.location.href;
    return (
      href === "about:blank" ||
      (new URL(href).origin === window.location.origin && new URL(href).pathname === popup.path)
    );
  } catch {
    return false;
  }
}
export function BrowserViewerWindow({
  popup,
  connection,
  onClosed,
}: {
  popup: ViewerWindow;
  connection: ViewerWindowConnection | null;
  onClosed: () => void;
}) {
  const closed = useEffectEvent(onClosed);
  const current = useRef<ViewerWindow | null>(null);
  const token = connection?.token,
    gatewayOrigin = connection?.origin;
  useEffect(() => {
    current.current = popup;
    let delivered = false;
    const started = Date.now();
    const closeOwned = () => {
      if (viewerWindowIsOpen(popup)) popup.window.close();
    };
    const listener = (event: MessageEvent) => {
      if (
        event.source !== popup.window ||
        event.origin !== window.location.origin ||
        delivered ||
        !token ||
        !gatewayOrigin
      )
        return;
      const parsed = viewerWindowMessageSchema.safeParse(event.data);
      if (
        !parsed.success ||
        parsed.data.type !== "ftrade-viewer-window-ready" ||
        parsed.data.nonce !== popup.nonce
      )
        return;
      popup.window.postMessage(
        {
          type: "ftrade-viewer-window-connection",
          nonce: popup.nonce,
          connection: { origin: gatewayOrigin, token },
        },
        window.location.origin,
      );
      delivered = true;
    };
    const bind = () => {
      if (!viewerWindowIsOpen(popup)) {
        closed();
        return;
      }
      if (!delivered && Date.now() - started >= 30_000) {
        closeOwned();
        closed();
        return;
      }
      if (!delivered)
        popup.window.postMessage(
          { type: "ftrade-viewer-window-bind", nonce: popup.nonce },
          window.location.origin,
        );
    };
    window.addEventListener("message", listener);
    window.addEventListener("pagehide", closeOwned);
    const timer = setInterval(bind, 500);
    bind();
    return () => {
      clearInterval(timer);
      window.removeEventListener("message", listener);
      window.removeEventListener("pagehide", closeOwned);
      current.current = null;
      queueMicrotask(() => {
        if (current.current !== popup) closeOwned();
      });
    };
  }, [popup, token, gatewayOrigin]);
  return null;
}
