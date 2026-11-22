"use client";
import { useLayoutEffect } from "react";

// Error fallbacks can mount before streamed layout metadata settles in <head>.
// Keep the fallback title active while mounted without adding a second <title>,
// and restore the latest underlying title on unmount.
export function RecoveryTitle({ title }: { title: string }) {
  useLayoutEffect(() => {
    let active = true;
    let previous = document.title;
    const apply = () => {
      if (!active) return;
      const element = document.head?.querySelector("title");
      if (!element) {
        document.title = title;
        return;
      }
      if (element.textContent !== title) {
        if (element.textContent) previous = element.textContent;
        element.textContent = title;
      }
    };
    apply();
    const head = document.head;
    const observer = head ? new MutationObserver(apply) : null;
    observer?.observe(head, { childList: true, subtree: true, characterData: true });
    return () => {
      active = false;
      observer?.disconnect();
      const element = document.head?.querySelector("title");
      if (element && element.textContent === title) element.textContent = previous;
    };
  }, [title]);
  return null;
}
