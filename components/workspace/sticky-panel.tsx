"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/** Keep short supporting content visible without trapping long content in a scroller. */
export function StickyPanel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | undefined>();
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const toolbar = panel.closest("main")?.querySelector(".workspace-toolbar");
    function measure() {
      if (!panel) return;
      const toolbarHeight = toolbar?.getBoundingClientRect().height ?? 0;
      const offset =
        (toolbarHeight <= Math.min(240, window.innerHeight / 3) ? toolbarHeight : 0) + 16;
      setTop(
        panel.getBoundingClientRect().height + offset + 16 <= window.innerHeight
          ? offset
          : undefined,
      );
    }
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    if (toolbar) observer.observe(toolbar);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="workspace-sticky-panel"
      data-sticky={top !== undefined}
      style={{ top }}
    >
      {children}
    </div>
  );
}
