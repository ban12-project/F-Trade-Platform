"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setupPublicationAction } from "@/lib/actions/browser-nodes";
import type { PublicationSetupResult } from "@/lib/browser-fleet/publication-setup-contract";

const reasons: Record<PublicationSetupResult["stage"], string> = {
  reviewed: "正在准备账号的发布服务…",
  ready: "发布服务已就绪。返回已审核内容，选择账号后确认即可。账号授权和人工暂停状态保持不变。",
  entry: "当前页面无法识别发布入口，系统适配未完成。请先完成登录，再重试连接。",
  composer: "当前页面的编辑器未能被系统可靠识别，发布已停止。",
  receipt: "当前页面缺少可验证的帖子回执结构，系统适配未完成。发布已停止。",
  identity: "无法确认当前登录账号，请完成登录或安全验证。",
  draft: "Facebook 编辑器中已有草稿，请保存或取消草稿后继续。系统不会覆盖它。",
  audience: "系统无法识别当前编辑器的范围控件，发布已停止。",
  page: "等待浏览器连接或登录完成。",
};
export function PublicationSetupPanel({ nodeId, runId }: { nodeId: string; runId: string }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("正在检查发布服务…");
  const [result, setResult] = useState<PublicationSetupResult>();
  const prepare = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      let response = await setupPublicationAction({ nodeId, runId, operation: "prepare" });
      if (response.ok && response.result.candidateHash)
        response = await setupPublicationAction({
          nodeId,
          runId,
          operation: "activate",
          candidateHash: response.result.candidateHash,
        });
      if (response.ok) {
        setResult(response.result);
        setMessage(reasons[response.result.stage]);
      } else setMessage(response.message);
    } catch {
      setMessage("发布服务检查暂未完成。登录完成后可重试，已选内容会保留。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [nodeId, runId]);
  useEffect(() => {
    void prepare();
  }, [prepare]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>发布服务</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p role="status">{message}</p>
        <p>新发布的范围为公开（所有人）。本步骤只检查账号和页面，不上传素材、不发布帖子。</p>
        {!result?.active ? (
          <Button type="button" variant="outline" disabled={busy} onClick={prepare}>
            {busy ? "正在连接…" : "登录完成，重试连接"}
          </Button>
        ) : null}
        <details>
          <summary>技术诊断</summary>
          <p>
            检查：{result?.stage ?? "连接中"}。系统负责编辑器、附件和回执验证，无需手动配置选择器。
          </p>
        </details>
      </CardContent>
    </Card>
  );
}
