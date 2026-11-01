"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function InteractiveSessionTimer({
  deadline,
  serverNow,
  disabled,
  onExtend,
}: {
  deadline: number;
  serverNow: number;
  disabled?: boolean;
  onExtend: (expectedDeadline: number) => Promise<boolean>;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    // A wrong local clock must not grant extra time. Rebase on each server observation.
    const received = performance.now();
    const update = () =>
      setRemaining(
        Math.max(0, Math.ceil((deadline - serverNow - (performance.now() - received)) / 1000)),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [deadline, serverNow]);
  const nearExpiry = remaining !== null && remaining <= 300;
  const expired = remaining === 0;
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-sm" role="timer" aria-live="off">
        接管剩余时间：
        {remaining === null
          ? "正在同步…"
          : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}
      </p>
      {nearExpiry && (
        <Alert variant={expired ? "destructive" : "default"}>
          <AlertTitle>{expired ? "接管已到期" : "接管即将到期"}</AlertTitle>
          <AlertDescription>
            {expired
              ? "当前会话不能延长。请等待浏览器释放后重新打开接管；尚未生效的核对需重新完成。"
              : "请完成操作或延长接管，到期后浏览器会关闭。延长不会续期发布核对结果，也不会允许发布。"}
          </AlertDescription>
        </Alert>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start"
        disabled={disabled || pending || !nearExpiry || expired}
        onClick={async () => {
          if (submitting.current) return;
          submitting.current = true;
          setPending(true);
          setFailed(false);
          try {
            setFailed(!(await onExtend(deadline)));
          } catch {
            setFailed(true);
          } finally {
            submitting.current = false;
            setPending(false);
          }
        }}
      >
        {pending ? "正在延长…" : "延长接管 30 分钟"}
      </Button>
      {!nearExpiry && (
        <p className="text-xs text-muted-foreground">
          剩余不足 5 分钟时可以延长；断线后保留 2 分钟用于重连。
        </p>
      )}
      {failed && (
        <p role="status" className="text-sm">
          未确认延长成功，请查看最新剩余时间和操作提示。不要关闭当前页面。
        </p>
      )}
    </div>
  );
}
