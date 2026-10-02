"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type browserNodesAction, inspectBrowserSandboxAction } from "@/lib/actions/browser-nodes";
import {
  type SandboxInspection,
  sandboxInspectionSchema,
} from "@/lib/browser-fleet/sandbox-inspection-contract";

type Summary = Awaited<ReturnType<typeof browserNodesAction>>[number]["sandbox"];
const labels = {
  stopped: "已停止",
  starting: "正在启动",
  running: "运行中",
  stopping: "正在停止",
  unknown: "需要核对",
};

const checkLabels = {
  ownership: "实例归属",
  resources: "计算资源",
  timeout: "运行时限",
  networkPolicy: "网络策略",
};
const failureLabels = {
  configuration: "应用的连接配置无效，需要管理员核对。",
  provider_authorization: "云端拒绝访问，请核对项目授权。",
  provider_unavailable: "暂时无法读取云端状态，请稍后检查。",
};

export function SandboxStatus({ sandbox, nodeId }: { sandbox: Summary; nodeId: string }) {
  const [pending, startTransition] = useTransition();
  const [inspection, setInspection] = useState<SandboxInspection | null>(null);
  const [error, setError] = useState("");
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
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            setError("");
            setInspection(null);
            try {
              const result = await inspectBrowserSandboxAction(
                sandboxInspectionSchema.parse({ nodeId }),
              );
              if (result.ok) setInspection(result.inspection);
              else setError(result.message);
            } catch {
              setError("检查未完成，请稍后重试。");
            }
          });
        }}
      >
        {pending ? "正在检查…" : "检查云端状态"}
      </Button>
      <div role="status" aria-live="polite" className="text-sm">
        {error}
        {inspection?.kind === "unavailable" ? failureLabels[inspection.reason] : null}
        {inspection?.kind === "observed" ? (
          <div className="space-y-1">
            <p>
              云端
              {inspection.state === "stopped"
                ? "已停止"
                : inspection.state === "running"
                  ? "正在运行"
                  : "正在切换状态"}{" "}
              ·{" "}
              <time dateTime={inspection.observedAt}>
                {new Date(inspection.observedAt).toLocaleTimeString()}
              </time>
            </p>
            <ul>
              {Object.entries(inspection.checks).map(([name, passed]) => (
                <li key={name}>
                  {checkLabels[name as keyof typeof checkLabels]}：{passed ? "匹配" : "需要核对"}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">此次检查不会启动浏览器或清除待核对记录。</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
