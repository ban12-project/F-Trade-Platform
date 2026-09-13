"use client";

import { Badge } from "@/components/ui/badge";
import type { browserNodesAction } from "@/lib/actions/browser-nodes";

type Summary = Awaited<ReturnType<typeof browserNodesAction>>[number]["sandbox"];
const labels = {
  stopped: "已停止",
  starting: "正在启动",
  running: "运行中",
  stopping: "正在停止",
  unknown: "需要核对",
};

export function SandboxStatus({ sandbox }: { sandbox: Summary }) {
  if (!sandbox) return <Badge variant="outline">自管服务器</Badge>;
  const updated = new Date(sandbox.updatedAt);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">按需浏览器</Badge>
        <Badge variant={sandbox.phase === "unknown" ? "destructive" : "secondary"}>
          {labels[sandbox.phase]}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        平台记录更新于{" "}
        <time dateTime={updated.toISOString()}>
          {updated.toISOString().replace("T", " ").replace(".000Z", " UTC")}
        </time>
        ；不是云端实时状态。
      </p>
      {sandbox.phase === "unknown" ? (
        <p className="text-sm text-muted-foreground">
          尚未确认云端是否停止，请先核对，勿重复启动。
        </p>
      ) : null}
    </div>
  );
}
