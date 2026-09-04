import { notFound } from "next/navigation";

import { VideoWorkspace } from "@/components/workspace/video-workspace";

export default function VideoWorkspaceTestingPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <VideoWorkspace projectId="00000000-0000-4000-8000-000000000721" projectTitle="Synthetic project workspace" products={[]} entries={[]} copyCandidates={[]} canReview />;
}
