"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  BrowserViewerWindow,
  openViewerWindow,
  type ViewerWindow,
} from "@/components/workspace/browser-viewer-window";

export function ViewerWindowFixture() {
  const [popup, setPopup] = useState<ViewerWindow | null>(null);
  const [message, setMessage] = useState("");
  const [authorized, setAuthorized] = useState(true);
  const [version, setVersion] = useState(0);
  return (
    <>
      <Button
        onClick={() => {
          setAuthorized(true);
          const opened = openViewerWindow("http://127.0.0.1:9427");
          setMessage(opened ? "" : "Independent window blocked; no ticket requested");
          setPopup(opened);
        }}
      >
        Open independent viewer
      </Button>
      <Button
        onClick={() => {
          setAuthorized(false);
          setPopup(openViewerWindow("http://127.0.0.1:9427"));
        }}
      >
        Open pending independent viewer
      </Button>
      <Button onClick={() => setAuthorized(true)}>Authorize pending viewer</Button>
      <Button onClick={() => setVersion((value) => value + 1)}>Refresh fixture</Button>
      <p>Fixture version: {version}</p>
      <p>{message}</p>
      {popup && (
        <BrowserViewerWindow
          popup={popup}
          onClosed={() => {
            setPopup(null);
            setMessage("Independent viewer closed");
          }}
          connection={
            authorized
              ? { origin: "http://127.0.0.1:9427", token: "isolated-viewer-fixture" }
              : null
          }
        />
      )}
    </>
  );
}
