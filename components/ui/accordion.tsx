"use client";

import {
  AccordionHeader as AccordionHeaderPrimitive,
  AccordionItem as AccordionItemPrimitive,
  AccordionPanel as AccordionPanelPrimitive,
  Accordion as AccordionPrimitive,
  AccordionTrigger as AccordionTriggerPrimitive,
} from "@ui-sdk/react/accordion";
import { ChevronDownIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Accordion({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive>) {
  return <AccordionPrimitive className={cn("flex w-full flex-col", className)} {...props} />;
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionItemPrimitive>) {
  return <AccordionItemPrimitive className={cn("not-last:border-b", className)} {...props} />;
}

function AccordionTrigger({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof AccordionTriggerPrimitive>, "children"> & {
  children?: React.ReactNode;
}) {
  return (
    <AccordionHeaderPrimitive className="flex">
      <AccordionTriggerPrimitive
        className={cn(
          "group/accordion-trigger relative flex flex-1 items-start justify-between rounded-lg border border-transparent py-2.5 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:after:border-ring aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon
          aria-hidden="true"
          data-slot="accordion-trigger-icon"
          className="pointer-events-none shrink-0 transition-transform duration-150 group-data-open/accordion-trigger:rotate-180"
        />
      </AccordionTriggerPrimitive>
    </AccordionHeaderPrimitive>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof AccordionPanelPrimitive>, "children"> & {
  children?: React.ReactNode;
}) {
  return (
    <AccordionPanelPrimitive
      className="h-(--accordion-panel-height) overflow-hidden text-sm transition-[height] duration-150 ease-[var(--ease-out)] data-ending-style:h-0 data-starting-style:h-0"
      {...props}
    >
      <div
        className={cn(
          "pt-0 pb-2.5 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
          className,
        )}
      >
        {children}
      </div>
    </AccordionPanelPrimitive>
  );
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
