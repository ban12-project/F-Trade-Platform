import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WorkspaceDirtyProvider } from "@/components/workspace/dirty-state";
import { PublicationPanel } from "@/components/workspace/publication-panel";

const projectId = "00000000-0000-4000-8000-000000000851";
const contentRef = "00000000-0000-4000-8000-000000000852";
export default function PublicationBatchFixture() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <Suspense fallback={null}>
        <WorkspaceDirtyProvider>
          <PublicationPanel
            projectId={projectId}
            candidates={[
              {
                id: contentRef,
                format: "text",
                title: "SYNTHETIC approved content",
                preview: "SYNTHETIC approved copy. No factory claims.",
                contentVersion: 7,
                previewDigest: "a".repeat(64),
              },
            ]}
            mediaOptions={[
              {
                contentRef,
                format: "image",
                mediaId: "synthetic-image",
                label: "合成已审核图片",
                preview: "SYNTHETIC approved copy. No factory claims.",
                contentVersion: 7,
                previewDigest: "b".repeat(64),
              },
            ]}
            channels={["Alpha", "Beta", "Login", "Paused"].map((name, i) => ({
              id: `synthetic-${i}`,
              channelRef: "facebook-synthetic",
              accountRef: `synthetic-${i}`,
              platform: "Facebook",
              name,
              ready: i < 2,
              blockers: i === 2 ? ["login"] : i === 3 ? ["paused"] : [],
              audience: "Public",
            }))}
            publications={[
              {
                id: "00000000-0000-4000-8000-000000000853",
                projectId,
                contentRef,
                format: "text",
                channelRef: "facebook-synthetic",
                accountRef: "synthetic-0",
                status: "published",
                createdAt: new Date("2026-11-01T00:00:00Z"),
                publishedAt: new Date("2026-11-01T00:01:00Z"),
                externalPublicationRef: "https://www.facebook.com/synthetic/posts/1",
              },
              {
                id: "00000000-0000-4000-8000-000000000854",
                projectId,
                contentRef,
                format: "text",
                channelRef: "facebook-synthetic",
                accountRef: "synthetic-1",
                status: "failed",
                createdAt: new Date("2026-11-01T00:00:00Z"),
                externalPublicationRef: null,
              },
            ]}
          />
        </WorkspaceDirtyProvider>
      </Suspense>
    </main>
  );
}
