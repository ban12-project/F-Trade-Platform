"use client";

import {
  type ListData,
  SelectContent as SelectContentPrimitive,
  SelectGroupLabel as SelectGroupLabelPrimitive,
  SelectGroup as SelectGroupPrimitive,
  SelectItemIndicator as SelectItemIndicatorPrimitive,
  SelectItem as SelectItemPrimitive,
  type SelectOptions,
  Select as SelectPrimitive,
  SelectSeparator as SelectSeparatorPrimitive,
  SelectTrigger as SelectTriggerPrimitive,
  SelectValue as SelectValuePrimitive,
} from "@ui-sdk/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

type SelectItemsInput<T> = ListData<T> | Record<string, string>;

function normalizeItems<T>(items?: SelectItemsInput<T>): ListData<T> | undefined {
  if (!items || Array.isArray(items)) {
    return items;
  }
  return Object.entries(items).map(([value, label]) => ({
    value: value as T,
    label,
  }));
}

type SingleSelectOptions<T> = Extract<SelectOptions<T, false>, { multiple?: false }>;

type SelectProps<T extends string = string> = Omit<SingleSelectOptions<T>, "items" | "multiple"> & {
  items?: SelectItemsInput<T>;
  children?: React.ReactNode;
};

function Select<T extends string = string>({
  items,
  value,
  defaultValue,
  ...props
}: SelectProps<T>) {
  return (
    <SelectPrimitive<T, false>
      {...({
        ...props,
        value: value === "" ? null : value,
        defaultValue: defaultValue === "" ? undefined : defaultValue,
        items: normalizeItems(items),
      } as React.ComponentProps<typeof SelectPrimitive<T, false>>)}
    />
  );
}

function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectGroupPrimitive>) {
  return <SelectGroupPrimitive className={cn("scroll-my-1 p-1", className)} {...props} />;
}

function SelectValue({ className, ...props }: React.ComponentProps<typeof SelectValuePrimitive>) {
  return <SelectValuePrimitive className={cn("flex flex-1 text-left", className)} {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: Omit<React.ComponentProps<typeof SelectTriggerPrimitive>, "children"> & {
  children?: React.ReactNode;
  size?: "sm" | "default";
}) {
  return (
    <SelectTriggerPrimitive
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none size-4 text-muted-foreground"
      />
    </SelectTriggerPrimitive>
  );
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: React.ComponentProps<typeof SelectContentPrimitive>) {
  return (
    <SelectContentPrimitive
      side={side}
      sideOffset={sideOffset}
      align={align}
      alignOffset={alignOffset}
      alignItemWithTrigger={alignItemWithTrigger}
      className={cn(
        "z-50 m-0 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border-0 bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none transition-[opacity,transform] duration-125 ease-[var(--ease-out)] data-closed:pointer-events-none data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    >
      {children}
    </SelectContentPrimitive>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectGroupLabelPrimitive>) {
  return (
    <SelectGroupLabelPrimitive
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectItem<T = string>({
  className,
  children,
  onFocus,
  ...props
}: Omit<React.ComponentProps<typeof SelectItemPrimitive<T>>, "children"> & {
  children?: React.ReactNode;
}) {
  return (
    <SelectItemPrimitive<T>
      onFocus={(event) => {
        onFocus?.(event);
        if (!event.currentTarget.hasAttribute("data-highlighted")) {
          event.currentTarget.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
        }
      }}
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    >
      <span className="flex flex-1 shrink-0 items-center gap-2 whitespace-nowrap">{children}</span>
      <SelectItemIndicatorPrimitive className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon aria-hidden="true" className="pointer-events-none size-4" />
      </SelectItemIndicatorPrimitive>
    </SelectItemPrimitive>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectSeparatorPrimitive>) {
  return (
    <SelectSeparatorPrimitive
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
