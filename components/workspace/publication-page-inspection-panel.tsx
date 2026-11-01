"use client";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inspectPublicationPageAction } from "@/lib/actions/browser-nodes";
import {
  type PublicationPageInspection,
  publicationPageInspectionInputSchema,
} from "@/lib/browser-fleet/publication-page-inspection-contract";
import { PublicationSetupPanel } from "./publication-setup-panel";

const labels = {
  identity: "页面身份",
  openComposer: "打开编辑器",
  composer: "编辑器",
  textbox: "正文控件",
  submit: "提交控件",
  audience: "受众控件",
  fileInput: "媒体输入（含隐藏控件）",
  attachmentName: "附件名称",
};
export function PublicationPageInspectionView({
  inspection,
}: {
  inspection: PublicationPageInspection;
}) {
  return (
    <div className="space-y-2" role="status">
      <p>观察时间：{inspection.observedAt}</p>
      <p>页面身份：{inspection.identityMatched ? "与候选配置匹配" : "需要核对"}</p>
      <Badge variant="outline">
        {inspection.candidateExpired ? "候选配置已过期，需要重新审核" : "候选配置尚未过期"}
      </Badge>
      <p className="text-sm text-muted-foreground">候选截止时间：{inspection.candidateExpiresAt}</p>
      {inspection.identityMatched ? (
        <>
          <ul className="space-y-1 text-sm">
            {Object.entries(inspection.controls).map(([key, count]) => (
              <li key={key}>
                {labels[key as keyof typeof labels]}：{count === 25 ? "至少 25" : count}
              </li>
            ))}
          </ul>
          <p>
            编辑器身份：
            {inspection.composerIdentityMatched === null
              ? "未观察"
              : inspection.composerIdentityMatched
                ? "匹配"
                : "需要核对"}{" "}
            · 正文为空：
            {inspection.composerEmpty === null ? "未观察" : inspection.composerEmpty ? "是" : "否"}
          </p>
          <p>
            受众与候选范围：
            {inspection.audienceMatchesCandidate === null
              ? "未观察"
              : inspection.audienceMatchesCandidate
                ? "匹配"
                : "需要核对"}{" "}
            · 可见视频预览：{inspection.videoPreviewCount}
          </p>
          <p>
            候选视频回执提示：
            {inspection.videoReceiptVisible === null
              ? "未配置或未观察"
              : inspection.videoReceiptVisible
                ? "当前可见"
                : "当前未观察到"}
          </p>
        </>
      ) : (
        <p>请核对当前受控页面的账号。身份与候选配置一致后才能核对其余控件。</p>
      )}
      <p className="break-all text-xs text-muted-foreground">
        配置摘要：{inspection.candidateHash}
      </p>
    </div>
  );
}
export function PublicationPageInspectionPanel({
  nodeId,
  runId,
}: {
  nodeId: string;
  runId: string;
}) {
  const pending = useRef(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [inspection, setInspection] = useState<PublicationPageInspection>();
  return (
    <div className="flex w-full flex-col gap-3">
      <PublicationSetupPanel nodeId={nodeId} runId={runId} />
      <details>
        <summary>高级：检查原有发布规则</summary>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>核对当前发布页面</CardTitle>
            <CardDescription>
              在本任务的受控 Facebook
              页面观察身份和编辑器控件。请先在接管页面打开空编辑器；页面审核与逐帖发布仍需分别确认。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (pending.current) return;
                pending.current = true;
                setBusy(true);
                setMessage("");
                setInspection(undefined);
                try {
                  const value = publicationPageInspectionInputSchema.parse({ nodeId, runId });
                  const result = await inspectPublicationPageAction(value);
                  if (result.ok) setInspection(result.inspection);
                  else setMessage(result.message);
                } catch {
                  setMessage("页面核对未完成。请检查接管任务与当前登录后重试。");
                } finally {
                  pending.current = false;
                  setBusy(false);
                }
              }}
            >
              {busy ? "正在核对…" : "只读核对当前页面"}
            </Button>
            {message ? <p role="status">{message}</p> : null}
            {inspection ? <PublicationPageInspectionView inspection={inspection} /> : null}
          </CardContent>
        </Card>
      </details>
    </div>
  );
}
