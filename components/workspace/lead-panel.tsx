"use client";

import dynamic from "next/dynamic";

// Keep follow-up editing and its timezone library out of unrelated record screens.
// Preserve server rendering so the panel remains visible before hydration.
export const LeadPanel = dynamic(() =>
  import("./lead-panel-content").then((module) => module.LeadPanel),
);
