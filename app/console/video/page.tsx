import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { requirePermission } from "@/lib/auth-guard";
import { loadVideoCanvasDocument } from "@/lib/video/canvas-store";
import { listReadyVideoProductSources, listVideoWorkspaceEntries } from "@/lib/video/store";

import { GuidedVideoWorkspace } from "./guided-video-workspace";

async function AuthorizedVideoWorkspace() {
  const session = await requirePermission("video:write");
  const [products, entries, canvas] = await Promise.all([listReadyVideoProductSources(), listVideoWorkspaceEntries(), loadVideoCanvasDocument(session.user.id)]);
  return <GuidedVideoWorkspace products={products} entries={entries} initialCanvas={canvas} canReview={session.user.role === "admin"} />;
}

export default function VideoPage() { return <Suspense fallback={<ConsoleLoading />}><AuthorizedVideoWorkspace /></Suspense>; }
