"use client";
import { useEffect } from "react";

// Error fallbacks can mount while Next's route metadata remains in the document.
// Update that title instead of adding a second one, and do not overwrite a new route's title.
export function RecoveryTitle({ title }: { title: string }) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      if (document.title === title) document.title = previous;
    };
  }, [title]);
  return null;
}
