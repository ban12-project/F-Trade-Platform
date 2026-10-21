import { notFound } from "next/navigation";
import { BrowserViewerWindowReceiver } from "@/components/workspace/browser-viewer-window-receiver";
export default function Page() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <main>
      <BrowserViewerWindowReceiver />
    </main>
  );
}
