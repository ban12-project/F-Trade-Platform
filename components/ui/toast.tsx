"use client";

import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
  type ToastType,
  toast,
} from "@ui-sdk/react/toast";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

function ToastIcon({ type }: { type: ToastType }) {
  switch (type) {
    case "success":
      return (
        <CircleCheckIcon
          className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
      );
    case "info":
      return (
        <InfoIcon
          className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400"
          aria-hidden="true"
        />
      );
    case "warning":
      return (
        <TriangleAlertIcon
          className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
      );
    case "error":
      return (
        <OctagonXIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      );
    case "loading":
      return (
        <Loader2Icon
          className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      );
    default:
      return null;
  }
}

function Toaster() {
  const [active, setActive] = useState(() => toast.toasts().length > 0);
  useEffect(() => {
    if (toast.toasts().length > 0) {
      setActive(true);
    }
    return toast.subscribe(() => {
      if (toast.toasts().length > 0) {
        setActive(true);
      }
    });
  }, []);
  if (!active) return null;
  return (
    <ToastRegion side="bottom" align="end" aria-label="通知">
      {(item) => (
        <Toast className="flex items-start gap-3 rounded-xl border border-border bg-popover p-3.5 text-sm text-popover-foreground shadow-lg data-[type=error]:border-destructive/40 data-[type=success]:border-emerald-500/30">
          <ToastIcon type={item.type} />
          <div className="min-w-0 flex-1 space-y-1">
            <ToastTitle className="leading-snug font-medium text-foreground" />
            <ToastDescription className="text-xs leading-relaxed text-muted-foreground empty:hidden" />
          </div>
          {item.action ? (
            <ToastAction className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" />
          ) : null}
          <ToastClose
            aria-label="关闭通知"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </ToastClose>
        </Toast>
      )}
    </ToastRegion>
  );
}

export { Toaster };
