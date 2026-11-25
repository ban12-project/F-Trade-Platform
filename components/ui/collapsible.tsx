"use client";

import {
  CollapsiblePanel as CollapsiblePanelPrimitive,
  Collapsible as CollapsiblePrimitive,
  CollapsibleTrigger as CollapsibleTriggerPrimitive,
} from "@ui-sdk/react/collapsible";
import type * as React from "react";

function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive>) {
  return <CollapsiblePrimitive {...props} />;
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsibleTriggerPrimitive>) {
  return <CollapsibleTriggerPrimitive {...props} />;
}

function CollapsibleContent({ ...props }: React.ComponentProps<typeof CollapsiblePanelPrimitive>) {
  return <CollapsiblePanelPrimitive {...props} />;
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
