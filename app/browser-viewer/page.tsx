import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrowserViewerWindowReceiver } from "@/components/workspace/browser-viewer-window-receiver";
import { requirePermission } from "@/lib/auth-guard";
export const prefetch = "partial";
async function AuthorizedViewer() {
  await requirePermission("settings:manage");
  return <BrowserViewerWindowReceiver />;
}
export default function Page() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>独立浏览器接管</CardTitle>
          <CardDescription>请核对远程账号与固定出口，再完成登录和必要验证。</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p role="status">正在核对平台会话…</p>}>
            <AuthorizedViewer />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
