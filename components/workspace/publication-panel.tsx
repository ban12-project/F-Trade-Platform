"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import { publicationProgress } from "@/lib/social/publication-presentation";
import type {
  PublicationCandidate,
  PublicationChannel,
  PublicationEntry,
} from "@/lib/social/publication-store";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { PublicationComposer, type PublicationMediaOptions } from "./publication-composer";
import { PublicationReconciliationForm } from "./publication-reconciliation-form";
import { VideoPublicationReconciliationForm } from "./video-publication-reconciliation-form";
import { WorkspaceLink } from "./workspace-link";
export function PublicationPanel({
  projectId,
  candidates,
  channels,
  publications,
  mediaOptions = [],
}: {
  projectId: string;
  candidates: PublicationCandidate[];
  channels: PublicationChannel[];
  publications: PublicationEntry[];
  mediaOptions?: PublicationMediaOptions;
}) {
  const timeZone = useBrowserTimeZone();
  const timestampFormat = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone,
  });
  const router = useRouter();
  const waiting = publications.some((p) => ["submitted", "pending", "queued"].includes(p.status));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [waiting, router]);
  const current = candidates.find((c) => c.format === "text");
  return (
    <div className="flex flex-col gap-4">
      {!current && mediaOptions.length === 0 && publications.length === 0 ? (
        <Empty role="region" aria-label="发布记录为空" className="border">
          <EmptyHeader>
            <EmptyTitle role="heading" aria-level={2}>
              暂无发布记录
            </EmptyTitle>
            <EmptyDescription>
              可先查看项目内容及其审核状态，或继续准备内容；这些工作无需连接社媒账号。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <WorkspaceLink
              href={`/workspace/content?project=${encodeURIComponent(projectId)}`}
              className={buttonVariants({ variant: "outline", className: "min-h-11" })}
            >
              查看项目内容
            </WorkspaceLink>
            <p className="text-sm text-muted-foreground">
              提交发布仍需人工确认，取得平台回执前不会显示为已发布。
            </p>
          </EmptyContent>
        </Empty>
      ) : null}
      {publications.map((item) => {
        const progress = publicationProgress(item.status, item.humanConfirmed, item.jobStatus);
        return (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle>{progress.label}</CardTitle>
              <CardDescription>
                {channels.find(
                  (a) => a.accountRef === item.accountRef && a.channelRef === item.channelRef,
                )?.name ?? item.accountRef}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-sm">{progress.detail}</p>
              <p className="text-sm text-muted-foreground">
                提交时间：
                <time dateTime={new Date(item.createdAt).toISOString()}>
                  {timestampFormat.format(new Date(item.createdAt))}（{timeZone}）
                </time>
              </p>
              {item.publishedAt && (
                <p className="text-sm">
                  发布时间：
                  <time dateTime={new Date(item.publishedAt).toISOString()}>
                    {timestampFormat.format(new Date(item.publishedAt))}（{timeZone}）
                  </time>
                </p>
              )}
              {item.failureLabel ? (
                <details className="text-sm text-muted-foreground">
                  <summary>查看处理详情</summary>
                  <p>{item.failureLabel}</p>
                </details>
              ) : null}
              {item.status === "unknown" && ["text", "image"].includes(item.format) ? (
                <PublicationReconciliationForm projectId={projectId} publicationId={item.id} />
              ) : null}
              {item.status === "unknown" && item.format === "video" ? (
                <VideoPublicationReconciliationForm projectId={projectId} publicationId={item.id} />
              ) : null}
              {item.externalPublicationRef ? (
                <p className="break-all text-sm">
                  发布凭证：
                  {/^https:\/\//.test(item.externalPublicationRef) ? (
                    <a
                      href={item.externalPublicationRef}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      查看平台帖子
                    </a>
                  ) : (
                    item.externalPublicationRef
                  )}
                </p>
              ) : null}
            </CardContent>
            <CardFooter>
              <WorkspaceLink
                href={workspaceRecordHref(
                  projectId,
                  item.format === "video" ? "video" : "content",
                  item.contentRef,
                )}
                className={buttonVariants({ variant: "outline" })}
              >
                查看发布内容
              </WorkspaceLink>
            </CardFooter>
          </Card>
        );
      })}

      {current || mediaOptions.length ? (
        <PublicationComposer
          projectId={projectId}
          contentRef={current?.id ?? mediaOptions[0].contentRef}
          text={current}
          media={mediaOptions}
          accounts={channels}
          retryTargets={channels.filter((a) =>
            publications.some(
              (p) => p.canRetry && p.channelRef === a.channelRef && p.accountRef === a.accountRef,
            ),
          )}
        />
      ) : null}
    </div>
  );
}
