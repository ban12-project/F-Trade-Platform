"use client";
import { useEffect } from "react";

// Error fallbacks can mount before streamed layout metadata settles in <head>.
// Keep the fallback title active while mounted without adding a second <title>,
// and restore the latest underlying title on unmount.
export function RecoveryTitle({ title }: { title: string }) {
  useEffect(() => {
    let previous = document.title;
    const apply = () => {
      if (document.title !== title) {
        if (document.title) previous = document.title;
        document.title = title;
      }
    };
    apply();
    const head = document.head;
    const observer = head ? new MutationObserver(apply) : null;
    observer?.observe(head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer?.disconnect();
      if (document.title === title) document.title = previous;
    };
  }, [title]);
  return null;
}
