"use client";

import { ArrowLeftIcon, FilmIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type MouseEvent, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import type {
  MarketingVideoCopyCandidate,
  MarketingVideoEditorEntry,
  ReadyVideoProductSource,
} from "@/lib/video/store";
import { useWorkspaceDirty, useWorkspaceDirtyState, WorkspaceDirtyProvider } from "./dirty-state";
import { MarketingVideoPanel } from "./marketing-video-panel";

function VideoWorkspaceInner({
  projectId,
  projectTitle,
  products,
  entries,
  copyCandidates,
  canReview,
  selectedId,
}: {
  projectId: string;
  projectTitle: string;
  products: ReadyVideoProductSource[];
  entries: MarketingVideoEditorEntry[];
  copyCandidates: MarketingVideoCopyCandidate[];
  canReview: boolean;
  selectedId?: string;
}) {
  const router = useRouter();
  const { requestNavigation } = useWorkspaceDirtyState();
  const [dirty, setDirty] = useState(false);
  useWorkspaceDirty("video-editor", dirty);
  function returnToProject(event: MouseEvent<HTMLElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    requestNavigation(() => router.push(`/workspace/${projectId}?panel=video`));
  }
  return (
    <main id="main-content" className="min-h-screen bg-muted/30 pb-24">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <LinkButton
              href={`/workspace/${projectId}?panel=video`}
              onClick={returnToProject}
              size="icon"
              variant="ghost"
              aria-label="返回营销视频步骤"
            >
              <ArrowLeftIcon />
            </LinkButton>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight">视频编辑器</h1>
              <p className="truncate text-xs text-muted-foreground">{projectTitle}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="secondary">
              <FilmIcon data-icon="inline-start" />
              独立编辑器
            </Badge>
            {dirty ? (
              <Badge variant="outline">有未保存修改</Badge>
            ) : (
              <Badge variant="outline">已同步</Badge>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h2 className="text-xl font-semibold tracking-tight">素材、预览与时间线</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            在一个连续编辑上下文中管理剪辑版本、私有预览、提审与成片决定。
          </p>
        </div>
        <MarketingVideoPanel
          projectId={projectId}
          products={products}
          entries={entries}
          copyCandidates={copyCandidates}
          canReview={canReview}
          selectedId={selectedId}
          onDirtyChange={setDirty}
        />
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
