"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type DirtyStateContextValue = {
  dirty: boolean;
  setDirty: (key: string, value: boolean) => void;
  requestNavigation: (action: () => void) => void;
};

const DirtyStateContext = createContext<DirtyStateContextValue | null>(null);

export function WorkspaceDirtyProvider({ children }: { children: ReactNode }) {
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const allowNextPop = useRef(false);
  const dirty = dirtyKeys.size > 0;
  const setDirty = useCallback((key: string, value: boolean) => {
    setDirtyKeys((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next.size === current.size && [...next].every((item) => current.has(item))
        ? current
        : next;
    });
  }, []);
  const requestNavigation = useCallback(
    (action: () => void) => {
      if (!dirty) {
        action();
        return;
      }
      pendingAction.current = action;
      setConfirmOpen(true);
    },
    [dirty],
  );
  function discardAndContinue() {
    const action = pendingAction.current;
    pendingAction.current = null;
    setConfirmOpen(false);
    action?.();
  }
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const popState = () => {
      if (allowNextPop.current) {
        allowNextPop.current = false;
        return;
      }
      window.history.forward();
      requestNavigation(() => {
        allowNextPop.current = true;
        window.history.back();
      });
    };
    window.addEventListener("popstate", popState);
    return () => window.removeEventListener("popstate", popState);
  }, [dirty, requestNavigation]);
  const value = useMemo(
    () => ({ dirty, setDirty, requestNavigation }),
    [dirty, requestNavigation, setDirty],
  );
  return (
    <DirtyStateContext value={value}>
      {children}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) pendingAction.current = null;
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>
              当前页面还有未保存内容。继续后这些修改无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={discardAndContinue}>
              放弃修改并离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DirtyStateContext>
  );
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
