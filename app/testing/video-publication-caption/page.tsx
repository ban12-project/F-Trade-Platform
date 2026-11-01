import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WorkspaceDirtyProvider } from "@/components/workspace/dirty-state";
import { FacebookMediaPanel } from "@/components/workspace/facebook-media-panel";
import { facebookMediaPreviewDigest } from "@/lib/social/facebook-media-confirmation";

const projectId = "00000000-0000-4000-8000-000000000801";
const contentRef = "00000000-0000-4000-8000-000000000802";
const captionRef = "00000000-0000-4000-8000-000000000803";
const mediaId = "asset-synthetic-caption-preview";
const options = [false, true].map((withCaption) => {
  const caption = withCaption ? "SYNTHETIC approved caption; no factory claims." : "";
  const captionSource = withCaption
    ? {
        contentRef: captionRef,
        contentVersion: 1,
        approvalRef: "00000000-0000-4000-8000-000000000804",
      }
    : undefined;
  return {
    contentRef,
    mediaId,
    format: "video" as const,
    contentVersion: 1,
    label: withCaption ? "SYNTHETIC 视频 · 已审核配文" : "SYNTHETIC 视频 · 无配文",
    preview: caption || "已批准 MP4 成片；无附加文案。",
    ...(captionSource ? { captionContentRef: captionRef } : {}),
    previewDigest: facebookMediaPreviewDigest({
      contentRef,
      mediaId,
      format: "video",
      contentVersion: 1,
      caption,
      ...(captionSource ? { captionSource } : {}),
    }),
  };
});

/** Synthetic form fixture; real Server Action still requires authentication. */
export default function VideoPublicationCaptionTestingPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6">
      <Suspense fallback={<p>正在读取发布预览…</p>}>
        <WorkspaceDirtyProvider>
          <FacebookMediaPanel
            projectId={projectId}
            contentRef={contentRef}
            options={options}
            channelRef="synthetic-channel"
            accountRef="synthetic-account"
            accounts={[
              {
                channelRef: "synthetic-channel",
                accountRef: "synthetic-account",
                name: "合成发布账号",
                audience: "Public",
                platform: "Facebook",
                ready: true,
                blockers: [],
              },
            ]}
          />
        </WorkspaceDirtyProvider>
      </Suspense>
    </main>
  );
}
