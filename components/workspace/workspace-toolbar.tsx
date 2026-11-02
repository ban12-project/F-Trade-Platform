"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

export function WorkspaceToolbar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [sticky, setSticky] = useState(false);
  useEffect(() => {
    const toolbar = ref.current;
    if (!toolbar) return;
    const measure = () =>
      setSticky(toolbar.getBoundingClientRect().height <= Math.min(240, window.innerHeight / 3));
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return (
    <header ref={ref} className="workspace-toolbar" data-sticky={sticky}>
      {children}
    </header>
  );
}
