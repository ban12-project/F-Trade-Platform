"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type DirtyStateContextValue = {
  dirty: boolean;
  setDirty: (key: string, value: boolean) => void;
  confirmNavigation: () => boolean;
};

const DirtyStateContext = createContext<DirtyStateContextValue | null>(null);
const leaveMessage = "还有未保存的修改，确定离开吗？";

export function WorkspaceDirtyProvider({ children }: { children: ReactNode }) {
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set());
  const restoringHistory = useRef(false);
  const dirty = dirtyKeys.size > 0;
  const setDirty = useCallback((key: string, value: boolean) => {
    setDirtyKeys((current) => {
      const next = new Set(current);
      if (value) next.add(key); else next.delete(key);
      return next.size === current.size && [...next].every((item) => current.has(item)) ? current : next;
    });
  }, []);
  const confirmNavigation = useCallback(() => !dirty || window.confirm(leaveMessage), [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const popState = () => {
      if (restoringHistory.current) { restoringHistory.current = false; return; }
      if (window.confirm(leaveMessage)) return;
      restoringHistory.current = true;
      window.history.forward();
    };
    window.addEventListener("popstate", popState);
    return () => window.removeEventListener("popstate", popState);
  }, [dirty]);
  const value = useMemo(() => ({ dirty, setDirty, confirmNavigation }), [confirmNavigation, dirty, setDirty]);
  return <DirtyStateContext value={value}>{children}</DirtyStateContext>;
}

export function useWorkspaceDirtyState() {
  const context = useContext(DirtyStateContext);
  if (!context) throw new Error("useWorkspaceDirtyState 必须在 WorkspaceDirtyProvider 中使用。");
  return context;
}

export function useWorkspaceDirty(key: string, dirty: boolean) {
  const { setDirty } = useWorkspaceDirtyState();
  useEffect(() => {
    setDirty(key, dirty);
    return () => setDirty(key, false);
  }, [dirty, key, setDirty]);
}
