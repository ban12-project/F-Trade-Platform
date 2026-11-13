"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const browserSnapshot = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverSnapshot = () => "UTC";

// Match SSR during hydration, then display the browser's local timezone.
export function useBrowserTimeZone() {
  return useSyncExternalStore(subscribe, browserSnapshot, serverSnapshot);
}
