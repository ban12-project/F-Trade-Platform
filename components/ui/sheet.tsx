"use client";

import {
  DialogBackdrop as SheetBackdropPrimitive,
  DialogClose as SheetClosePrimitive,
  DialogContent as SheetContentPrimitive,
  DialogDescription as SheetDescriptionPrimitive,
  Dialog as SheetPrimitive,
  DialogTitle as SheetTitlePrimitive,
  DialogTrigger as SheetTriggerPrimitive,
} from "@ui-sdk/react/dialog";
import { XIcon } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const emptySubscribe = () => () => {};
const getBodyContainer = () => document.body;
const getServerContainer = () => undefined;

function useBodyPortalContainer() {
  return React.useSyncExternalStore(emptySubscribe, getBodyContainer, getServerContainer);
}

function Sheet({
  container,
  closeOnOutsidePress = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive>) {
  const defaultContainer = useBodyPortalContainer();
  return (
    <SheetPrimitive
      container={container ?? defaultContainer}
      closeOnOutsidePress={closeOnOutsidePress}
      {...props}
    />
  );
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetTriggerPrimitive>) {
  return <SheetTriggerPrimitive {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetClosePrimitive>) {
  return <SheetClosePrimitive {...props} />;
}

function SheetPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetBackdropPrimitive>) {
  return (
    <SheetBackdropPrimitive
      data-sheet-overlay="true"
      className={cn(
        "fixed inset-0 z-50 m-0 border-0 bg-black/10 p-0 data-open:transition-opacity data-open:duration-200 data-open:ease-[var(--ease-out)] data-closed:pointer-events-none data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  showOverlay = true,
  ...props
}: Omit<React.ComponentProps<typeof SheetContentPrimitive>, "children"> & {
  children?: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
  showOverlay?: boolean;
}) {
  return (
    <SheetPortal>
      {showOverlay ? <SheetOverlay /> : null}
      <SheetContentPrimitive
        data-sheet="true"
        data-side={side}
        className={cn(
          "fixed inset-auto z-50 m-0 flex overscroll-contain flex-col gap-4 border-0 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg data-open:transition-[transform,opacity] data-open:duration-200 data-open:ease-[var(--ease-drawer)] outline-none data-closed:pointer-events-none data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-4 data-[side=bottom]:data-starting-style:translate-y-4 data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:-translate-x-4 data-[side=left]:data-starting-style:-translate-x-4 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-4 data-[side=right]:data-starting-style:translate-x-4 data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:-translate-y-4 data-[side=top]:data-starting-style:-translate-y-4 data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
          typeof className === "string" ? className : undefined,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetClosePrimitive
            render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />}
          >
            <XIcon aria-hidden="true" />
            <span className="sr-only">关闭</span>
          </SheetClosePrimitive>
        )}
      </SheetContentPrimitive>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetTitlePrimitive>) {
  return (
    <SheetTitlePrimitive
      className={cn("font-heading text-base font-medium text-foreground", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetDescriptionPrimitive>) {
  return (
    <SheetDescriptionPrimitive
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
