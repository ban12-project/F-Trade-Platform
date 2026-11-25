"use client";

import {
  ToggleGroup as ToggleGroupPrimitive,
  Toggle as TogglePrimitive,
} from "@ui-sdk/react/toggle";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";
import { toggleVariants } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
});

function ToggleGroup<T extends string = string>({
  className,
  style,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  ...props
}: Omit<React.ComponentProps<typeof ToggleGroupPrimitive<T>>, "children"> &
  VariantProps<typeof toggleVariants> & {
    children?: React.ReactNode;
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  }) {
  return (
    <ToggleGroupPrimitive<T>
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      orientation={orientation}
      style={
        typeof style === "function"
          ? (state) => ({ "--gap": spacing, ...style(state) }) as React.CSSProperties
          : ({ "--gap": spacing, ...style } as React.CSSProperties)
      }
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-vertical:flex-col data-vertical:items-stretch",
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size, spacing, orientation }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive> & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);

  return (
    <TogglePrimitive
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-lg group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-lg group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-lg group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-lg group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
}

export { ToggleGroup, ToggleGroupItem };
