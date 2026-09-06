import Link from "next/link";
import { Suspense } from "react";
import { FacebookAccountPanel } from "@/components/workspace/facebook-account-panel";
import { FacebookMediaPanel } from "@/components/workspace/facebook-media-panel";
import { requirePermission } from "@/lib/auth-guard";

async function AccountContent() {
  await requirePermission("settings:manage");
  return (
    <div className="space-y-6">
      <FacebookAccountPanel />
      <FacebookMediaPanel />
    </div>
  );
}
export default function FacebookAccountPage() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Facebook 发布与账号连接</h1>
        <p className="text-muted-foreground">加密凭据、人工验证、图片和视频发布。</p>
        <Link href="/workspace/browsers" className="text-sm underline underline-offset-4">
          多浏览器节点与按需队列
        </Link>
      </div>
      <Suspense fallback={<p>正在读取账号权限…</p>}>
        <AccountContent />
      </Suspense>
    </main>
  );
}
