import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { requireRole } from "@/lib/auth-guard";
import { listReadyVideoProductSources, listVideoWorkspaceEntries } from "@/lib/video/store";

import { VideoWorkspacePanel } from "./video-workspace-panel";

async function AuthorizedVideoWorkspace() {
  await requireRole("admin");
  const [products, entries] = await Promise.all([listReadyVideoProductSources(), listVideoWorkspaceEntries()]);
  return <VideoWorkspacePanel products={products} entries={entries} />;
}

export default function VideoPage() {
  return <Suspense fallback={<ConsoleLoading />}><AuthorizedVideoWorkspace /></Suspense>;
}
