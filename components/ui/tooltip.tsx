"use client";

import {
  TooltipArrow,
  TooltipContent as TooltipContentPrimitive,
  Tooltip as TooltipPrimitive,
  TooltipTrigger as TooltipTriggerPrimitive,
} from "@ui-sdk/react/tooltip";
import type * as React from "react";

import { cn } from "@/lib/utils";

function TooltipProvider({ children }: { children: React.ReactNode; delay?: number }) {
  return <>{children}</>;
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive>) {
  return <TooltipPrimitive {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipTriggerPrimitive>) {
  return <TooltipTriggerPrimitive {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: Omit<React.ComponentProps<typeof TooltipContentPrimitive>, "children"> & {
  children?: React.ReactNode;
}) {
  return (
    <TooltipContentPrimitive
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      className={cn(
        "z-50 m-0 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 overflow-visible rounded-md border-0 bg-foreground px-3 py-1.5 text-xs text-background transition-[opacity,transform] duration-125 ease-[var(--ease-out)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    >
      {children}
      <TooltipArrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
    </TooltipContentPrimitive>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
