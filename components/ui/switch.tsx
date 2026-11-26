"use client";

import {
  Switch as SwitchPrimitive,
  SwitchThumb as SwitchThumbPrimitive,
} from "@ui-sdk/react/switch";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Switch({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SwitchPrimitive>, "children">) {
  return (
    <SwitchPrimitive
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-checked:bg-primary dark:bg-input/80 dark:data-checked:bg-primary",
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    >
      <SwitchThumbPrimitive className="pointer-events-none block size-4 rounded-full bg-background shadow-xs ring-0 transition-transform data-unchecked:translate-x-0 data-checked:translate-x-4 rtl:data-checked:-translate-x-4 dark:bg-foreground dark:data-checked:bg-primary-foreground" />
    </SwitchPrimitive>
  );
}

export { Switch };
