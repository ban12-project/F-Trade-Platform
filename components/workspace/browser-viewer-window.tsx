"use client";
import { useEffect, useEffectEvent, useRef } from "react";
import type { ViewerWindowConnection } from "@/lib/browser-fleet/viewer-window-contract";
export type ViewerWindow = { window: Window; nonce: string; origin: string };
export function openViewerWindow(origin: string | null): ViewerWindow | null {
  if (!origin) return null;
  const gateway = URL.parse(origin);
  if (!gateway || !["https:", "http:"].includes(gateway.protocol) || gateway.origin !== origin)
    return null;
  const nonce = crypto.randomUUID();
  const popup = window.open(`${origin}/viewer#${nonce}`, "_blank", "popup,width=1440,height=960");
  if (!popup) return null;
  // The gateway stays unauthenticated until the server action returns its ticket.
  popup.opener = null;
  return { window: popup, nonce, origin };
}
export function viewerWindowIsOpen(popup: ViewerWindow) {
  return !popup.window.closed;
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
    let gatewayDelivered = false;
    const started = Date.now();
    const closeOwned = () => {
      if (!popup.window.closed) popup.window.close();
    };
    const listener = (event: MessageEvent) => {
      if (
        event.source !== popup.window ||
        event.origin !== popup.origin ||
        gatewayOrigin !== popup.origin ||
        !token ||
        gatewayDelivered ||
        event.data?.type !== "ftrade-browser-ready" ||
        event.data?.nonce !== popup.nonce
      )
        return;
      popup.window.postMessage(
        { type: "ftrade-browser-ticket", nonce: popup.nonce, token },
        popup.origin,
      );
      gatewayDelivered = true;
    };
    const bind = () => {
      if (!viewerWindowIsOpen(popup)) {
        closed();
        return;
      }
      if (!gatewayDelivered && Date.now() - started >= 30_000) {
        closeOwned();
        closed();
        return;
      }
      if (!gatewayDelivered)
        popup.window.postMessage(
          { type: "ftrade-browser-probe", nonce: popup.nonce },
          popup.origin,
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
