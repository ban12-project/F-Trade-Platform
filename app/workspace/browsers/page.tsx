import { Suspense } from "react";
import { BrowserNodesPanel } from "@/components/workspace/browser-nodes-panel";
import { requirePermission } from "@/lib/auth-guard";

async function Content() {
  await requirePermission("settings:manage");
  return <BrowserNodesPanel sandboxEnabled={process.env.BROWSER_SANDBOX_ENABLED === "1"} />;
}
export default function BrowserNodesPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">浏览器与按需队列</h1>
      <p className="text-muted-foreground">
        托管浏览器只在需要时启动，空闲后停止。每个账号独立保存会话；创建节点不会立即启动浏览器。
      </p>
      <Suspense fallback={<p>正在读取节点权限…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
