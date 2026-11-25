"use client";

import { CheckboxIndicator, Checkbox as CheckboxPrimitive } from "@ui-sdk/react/checkbox";
import { CheckIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

type CheckboxProps = Omit<React.ComponentProps<typeof CheckboxPrimitive>, "onCheckedChange"> & {
  onCheckedChange?: (checked: boolean) => void;
};

function Checkbox({ className, onCheckedChange, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive
      onCheckedChange={(next) => onCheckedChange?.(next === true)}
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxIndicator className="grid place-content-center text-current transition-none [&>svg]:size-3.5">
        <CheckIcon aria-hidden="true" />
      </CheckboxIndicator>
    </CheckboxPrimitive>
  );
}

export { Checkbox };
