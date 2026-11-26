"use client";

import {
  RadioGroup as RadioGroupPrimitive,
  RadioIndicator as RadioIndicatorPrimitive,
  Radio as RadioPrimitive,
} from "@ui-sdk/react/radio";
import * as React from "react";

import { cn } from "@/lib/utils";

function RadioGroup<T extends string = string>({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive<T>>) {
  return (
    <RadioGroupPrimitive<T>
      className={cn("grid gap-2", typeof className === "string" ? className : undefined)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: Omit<React.ComponentProps<typeof RadioPrimitive>, "children">) {
  return (
    <RadioPrimitive
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-full border border-input transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    >
      <RadioIndicatorPrimitive className="flex items-center justify-center">
        <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
      </RadioIndicatorPrimitive>
    </RadioPrimitive>
  );
}

function RadioGroupChoice({
  value,
  disabled,
  className,
  children,
  itemRef,
  onBlur,
  ...props
}: Omit<React.ComponentProps<"label">, "htmlFor" | "itemRef"> & {
  value: string;
  disabled?: boolean;
  itemRef?: React.Ref<HTMLButtonElement>;
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
}) {
  const radioId = React.useId();

  return (
    <label
      htmlFor={radioId}
      data-slot="radio-choice"
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/50 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-data-checked:border-primary has-data-checked:bg-primary/5 has-data-disabled:cursor-not-allowed has-data-disabled:opacity-50 dark:bg-input/20 dark:has-data-checked:bg-primary/10",
        className,
      )}
      {...props}
    >
      <RadioGroupItem
        id={radioId}
        ref={itemRef}
        value={value}
        disabled={disabled}
        onBlur={onBlur}
      />
      <span className="min-w-0 leading-snug">{children}</span>
    </label>
  );
}

export { RadioGroup, RadioGroupChoice, RadioGroupItem };
