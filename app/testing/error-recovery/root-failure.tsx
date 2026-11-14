"use client";
import { useEffect, useState } from "react";

// Mounted outside route boundaries only in explicitly enabled testing builds.
export function TestingRootFailure() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const target = window as Window & { __fTradeFailRoot?: () => void };
    target.__fTradeFailRoot = () => setFailed(true);
    return () => {
      delete target.__fTradeFailRoot;
    };
  }, []);
  if (failed) throw new Error("SYNTHETIC_PRIVATE_ROOT_DETAIL");
  return null;
}
