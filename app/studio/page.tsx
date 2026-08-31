import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { requirePermission } from "@/lib/auth-guard";
import { loadVideoCanvasDocument } from "@/lib/video/canvas-store";
import { listReadyVideoProductSources, listVideoWorkspaceEntries } from "@/lib/video/store";

import { VideoStudioCanvas } from "./video-studio-canvas";

async function AuthorizedStudio() {
  const session = await requirePermission("video:write");
  const [products, entries, canvas] = await Promise.all([
    listReadyVideoProductSources(),
    listVideoWorkspaceEntries(),
    loadVideoCanvasDocument(session.user.id),
  ]);

  return <VideoStudioCanvas products={products} entries={entries} initialCanvas={canvas} />;
}

export default function StudioPage() {
  return (
    <Suspense fallback={<ConsoleLoading />}>
      <AuthorizedStudio />
    </Suspense>
  );
}
