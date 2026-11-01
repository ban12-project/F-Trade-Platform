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
  const router = useRouter();
  const waiting = publications.some((p) => ["submitted", "pending", "queued"].includes(p.status));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [waiting, router]);
  const current = candidates.find((c) => c.format === "text");
  return (
    <div className="space-y-4">
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
                提交时间：{new Date(item.createdAt).toLocaleString()}
              </p>
              {item.publishedAt && (
                <p className="text-sm">发布时间：{new Date(item.publishedAt).toLocaleString()}</p>
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
