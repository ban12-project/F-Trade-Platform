import { notFound } from "next/navigation";
import {
  PublicationPageInspectionPanel,
  PublicationPageInspectionView,
} from "@/components/workspace/publication-page-inspection-panel";
export default function Page() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1>合成页面核对结果</h1>
      <PublicationPageInspectionView
        inspection={{
          version: 1,
          observedAt: "2026-10-11T00:00:00Z",
          candidateHash: "a".repeat(64),
          candidateExpiresAt: "2000-01-01T00:00:00Z",
          candidateExpired: true,
          identityMatched: true,
          controls: {
            identity: 1,
            openComposer: 1,
            composer: 1,
            textbox: 1,
            submit: 1,
            audience: 1,
            fileInput: 1,
            attachmentName: 0,
          },
          composerIdentityMatched: true,
          composerEmpty: true,
          audienceMatchesCandidate: true,
          videoPreviewCount: 0,
          videoReceiptVisible: null,
        }}
      />
      <PublicationPageInspectionPanel
        nodeId="00000000-0000-4000-8000-000000000991"
        runId="00000000-0000-4000-8000-000000000992"
      />
    </main>
  );
}
