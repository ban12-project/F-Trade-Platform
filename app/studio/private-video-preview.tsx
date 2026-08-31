"use client";

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PrivateVideoPreview({ assetRef, title }: { assetRef: string; title: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const previewPath = `/api/video-preview/${encodeURIComponent(assetRef)}`;

  return <Card className="overflow-hidden">
    <CardHeader className="gap-2 p-4 pb-2">
      <div className="flex items-center justify-between gap-2"><CardTitle className="text-sm">{title}</CardTitle><Badge variant="outline">私有预览</Badge></div>
      <CardDescription>只向当前管理员会话流式提供媒体；预览不表示审核批准或发布。</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-2 p-4 pt-2">
      <video
        className="aspect-video w-full rounded-md bg-muted"
        controls
        onCanPlay={() => setState("ready")}
        onError={() => setState("error")}
        preload="metadata"
        src={previewPath}
      >
        浏览器不支持视频预览。
      </video>
      {state === "loading" ? <p className="text-xs text-muted-foreground">正在验证并加载私有视频…</p> : null}
      {state === "error" ? <Alert variant="destructive"><AlertTitle>暂时无法预览</AlertTitle><AlertDescription>该资产不存在、当前会话无权访问，或媒体无法播放。请刷新后重试。</AlertDescription></Alert> : null}
    </CardContent>
  </Card>;
}
