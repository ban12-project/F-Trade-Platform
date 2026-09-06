import { Suspense } from "react";
import { BrowserNodesPanel } from "@/components/workspace/browser-nodes-panel";
import { requirePermission } from "@/lib/auth-guard";

async function Content() {
  await requirePermission("settings:manage");
  return <BrowserNodesPanel />;
}
export default function BrowserNodesPage() {
  return <main className="mx-auto w-full max-w-5xl space-y-6 p-6"><h1 className="text-2xl font-semibold">Browser 节点与按需队列</h1><p className="text-muted-foreground">一台 VPS 一个接入 Key，每个账号独立会话，按容量启动与释放。离线账号的私信只能在下一次成功轮询时导入。</p><Suspense fallback={<p>正在读取节点权限…</p>}><Content /></Suspense></main>;
}
