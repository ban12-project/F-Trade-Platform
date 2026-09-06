"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { facebookAccountStatusAction } from "@/lib/actions/facebook-account";
/** In-app notification only; does not request OS notification permissions. */
export function FacebookAttentionNotice() {
  const [state, setState] = useState("");
  useEffect(() => {
    let gone = false;
    let busy = false;
    const poll = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const value = await facebookAccountStatusAction();
        if (!gone) setState(value.authState);
      } catch {
        /* Configuration absent or access revoked: never reveal account data. */
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 15_000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, []);
  if (!["login_required", "two_factor_required", "checkpoint_required"].includes(state))
    return null;
  return (
    <div className="fixed bottom-24 right-4 z-40 w-[min(26rem,calc(100vw-2rem))]">
      <Alert role="alert">
        <AlertTitle>
          Facebook{" "}
          {state === "two_factor_required"
            ? "需要两步验证"
            : state === "checkpoint_required"
              ? "需要安全验证"
              : "需要重新登录"}
        </AlertTitle>
        <AlertDescription>
          自动任务已暂停。
          <Link href="/workspace/facebook" className="font-medium underline">
            接入账号验证
          </Link>
        </AlertDescription>
      </Alert>
    </div>
  );
}
