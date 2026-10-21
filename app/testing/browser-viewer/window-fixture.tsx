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
  const [version, setVersion] = useState(0);
  return (
    <>
      <Button
        onClick={() => {
          const opened = openViewerWindow("/testing/browser-viewer/window");
          setMessage(opened ? "" : "Independent window blocked; no ticket requested");
          setPopup(opened);
        }}
      >
        Open independent viewer
      </Button>
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
          connection={{ origin: "http://127.0.0.1:9427", token: "isolated-viewer-fixture" }}
        />
      )}
    </>
  );
}
