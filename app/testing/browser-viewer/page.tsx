import { notFound } from "next/navigation";
import { BrowserViewer } from "@/components/workspace/browser-viewer";
import { ViewerWindowFixture } from "./window-fixture";

export default function BrowserViewerFixture() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <h1>Isolated viewer fixture — no account or business data</h1>
      <BrowserViewer origin="http://127.0.0.1:9427" token="isolated-viewer-fixture" />
      <ViewerWindowFixture />
    </main>
  );
}
