"use client";

import { ArrowLeftIcon, FilmIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  MarketingVideoCopyCandidate,
  MarketingVideoEditorEntry,
  ReadyVideoProductSource,
} from "@/lib/video/store";
import type { VideoWorkspaceSelection } from "@/lib/video/workspace-selection";
import { workspaceCreateHref, workspaceRecordHref } from "@/lib/workspace/navigation";
import { useWorkspaceDirty, useWorkspaceDirtyState, WorkspaceDirtyProvider } from "./dirty-state";
import { MarketingVideoPanel, videoStateLabel } from "./marketing-video-panel";
import { WorkspaceLink } from "./workspace-link";

function VideoWorkspaceInner({
  projectId,
  projectTitle,
  products,
  entries,
  copyCandidates,
  canReview,
  canWrite,
  selection,
}: {
  projectId: string;
  projectTitle: string;
  products: ReadyVideoProductSource[];
  entries: MarketingVideoEditorEntry[];
  copyCandidates: MarketingVideoCopyCandidate[];
  canReview: boolean;
  canWrite: boolean;
  selection: VideoWorkspaceSelection;
}) {
  const [editorDirty, setDirty] = useState(false);
  useWorkspaceDirty("video-editor", editorDirty);
  const { dirty } = useWorkspaceDirtyState();
  const active =
    selection.mode === "record" ? entries.find((entry) => entry.id === selection.id) : undefined;
  const productId =
    active?.productId ?? (selection.mode === "create" ? selection.productId : undefined);
  const product = products.find((item) => item.id === productId);
  const back = `/workspace/content?project=${projectId}`;
  return (
    <main id="main-content" className="min-h-screen bg-muted/30 pb-24">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <WorkspaceLink
              href={back}
              className={buttonVariants({ size: "icon", variant: "ghost" })}
              aria-label="返回内容与发布"
            >
              <ArrowLeftIcon />
            </WorkspaceLink>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {selection.mode === "collection"
                  ? "营销视频"
                  : selection.mode === "create"
                    ? "制作视频"
                    : "视频编辑器"}
              </h1>
              <p className="truncate text-xs text-muted-foreground">{projectTitle}</p>
            </div>
          </div>
          <Badge variant="outline">{!canWrite ? "只读" : dirty ? "有未保存修改" : "已同步"}</Badge>
        </div>
      </header>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <p className="text-sm text-muted-foreground">
          <FilmIcon className="mr-1 inline size-4" />
          视频是一种可选内容形式。图文内容可以独立制作与发布。
        </p>
        {product ? (
          <p className="text-sm">
            来源产品：
            <WorkspaceLink
              className="underline underline-offset-4"
              href={workspaceRecordHref(projectId, "product", product.id)}
            >
              {product.productName}
            </WorkspaceLink>
          </p>
        ) : null}
        {selection.mode === "unavailable" ? (
          <Alert>
            <AlertTitle>无法打开指定工作</AlertTitle>
            <AlertDescription>{selection.message}</AlertDescription>
          </Alert>
        ) : selection.mode === "collection" ? (
          <Card>
            <CardHeader>
              <CardTitle>选择视频继续</CardTitle>
              <CardDescription>每个入口对应一份具体剪辑稿；也可以按需制作新视频。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {canWrite ? (
                <WorkspaceLink
                  href={workspaceCreateHref(projectId, "video")}
                  className={buttonVariants({})}
                >
                  制作新视频
                </WorkspaceLink>
              ) : null}
              {entries.map((entry) => (
                <WorkspaceLink
                  key={entry.id}
                  href={workspaceRecordHref(projectId, "video", entry.id)}
                  className="rounded-lg border p-3 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block break-words font-medium">
                    {entry.productName} · {entry.objective}
                  </span>
                  <span className="text-muted-foreground">{videoStateLabel(entry.state)}</span>
                </WorkspaceLink>
              ))}
              {!entries.length ? (
                <p className="text-sm text-muted-foreground">
                  还没有视频。
                  {canWrite
                    ? "需要这种内容形式时，先选择已核实产品和授权素材。"
                    : "可以返回内容与发布查看已有图文，或请项目编辑者创建视频。"}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : selection.mode === "record" && !active ? (
          <Alert>
            <AlertTitle>这条视频已不可用</AlertTitle>
            <AlertDescription>请返回内容列表重新选择。</AlertDescription>
          </Alert>
        ) : (
          <>
            {!canWrite ? (
              <p role="status" className="text-sm text-muted-foreground">
                当前为只读视图。请由项目编辑者处理写入或审核。
              </p>
            ) : null}
            <fieldset disabled={!canWrite} className="min-w-0 border-0 p-0">
              <MarketingVideoPanel
                key={active?.id ?? `new:${productId ?? ""}`}
                projectId={projectId}
                products={
                  productId && selection.mode === "create"
                    ? products.filter((item) => item.id === productId)
                    : products
                }
                entries={active ? [active] : []}
                copyCandidates={selection.mode === "create" && canWrite ? copyCandidates : []}
                canReview={canWrite && canReview}
                mode={selection.mode}
                selectedId={active?.id}
                onDirtyChange={setDirty}
              />
            </fieldset>
          </>
        )}
      </div>
    </main>
  );
}

export function VideoWorkspace(props: Parameters<typeof VideoWorkspaceInner>[0]) {
  return (
    <WorkspaceDirtyProvider>
      <VideoWorkspaceInner {...props} />
    </WorkspaceDirtyProvider>
  );
}
