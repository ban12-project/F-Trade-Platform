"use client";

import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setupInboxAction } from "@/lib/actions/browser-nodes";
import type { InboxSetupResult } from "@/lib/browser-fleet/inbox-setup-contract";

const reasons: Record<InboxSetupResult["stage"], string> = {
  reviewed: "已核对 Messenger 收件箱结构，正在激活收件箱同步能力…",
  ready: "收件箱同步已启用。现在可执行被动收件箱同步；系统仅只读抓取私信，不发送回复。",
  identity: "无法确认当前 Messenger 登录账号与绑定账号一致，请确认登录后重试。",
  attention: "当前账号处于登录、两步验证或安全检查页面，请先完成处理再重试。",
  page: "当前页面尚未进入可识别的 Messenger 收件箱（或尚未加载完成），请重试或先手动打开 Messenger。",
};

export function InboxSetupPanel({
  nodeId,
  runId,
  onActivated,
}: {
  nodeId: string;
  runId: string;
  onActivated?: () => Promise<void>;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("尚未核对当前接管会话的收件箱同步规则。");
  const [result, setResult] = useState<InboxSetupResult>();

  async function verifyAndActivate() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      let response = await setupInboxAction({ nodeId, runId, operation: "prepare" });
      if (response.ok && response.result.candidateHash) {
        response = await setupInboxAction({
          nodeId,
          runId,
          operation: "activate",
          candidateHash: response.result.candidateHash,
        });
      }
      if (response.ok) {
        setResult(response.result);
        setMessage(reasons[response.result.stage]);
        if (response.result.active) await onActivated?.();
      } else {
        setMessage(response.message);
      }
    } catch {
      setMessage("收件箱同步检查未完成，请确认 Messenger 已就绪后重试。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>收件箱同步（Messenger DM）</CardTitle>
        <Badge variant="outline">{result?.active ? "已启用" : "未激活"}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p role="status" className="text-sm">
          {message}
        </p>
        <p className="text-sm text-muted-foreground">
          仅只读核对 Facebook Messenger 收件箱与当前登录身份，不发送私信或触发自动回复。
        </p>
        {result?.inboxVerified ? (
          <p className="text-sm text-muted-foreground">
            {result.emptyInbox
              ? "已确认空收件箱状态（无聊天会话）。"
              : `已确认可见会话数：${result.threadCount}。`}
          </p>
        ) : null}
        <Button type="button" variant="outline" disabled={busy} onClick={verifyAndActivate}>
          {busy
            ? "正在核对 Messenger…"
            : result?.active
              ? "重新核对收件箱同步"
              : "核对并启用收件箱同步"}
        </Button>
      </CardContent>
    </Card>
  );
}
