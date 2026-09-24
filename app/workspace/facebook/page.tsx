import Link from "next/link";
import { Suspense } from "react";
import { FacebookAccountPanel } from "@/components/workspace/facebook-account-panel";
import { FacebookMediaPanel } from "@/components/workspace/facebook-media-panel";
import { requirePermission } from "@/lib/auth-guard";

async function AccountContent() {
  await requirePermission("settings:manage");
  const legacyWorker = process.env.SOCIAL_FACEBOOK_WORKER_ENABLED === "1";
  return (
    <div className="space-y-6">
      {legacyWorker ? (
        <FacebookAccountPanel />
      ) : (
        <p className="text-muted-foreground text-sm">
          账号连接与代理由多浏览器节点管理。本页仅提交已审核的图片或视频。
        </p>
      )}
      <FacebookMediaPanel />
    </div>
  );
}
export default function FacebookAccountPage() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Facebook 素材发布</h1>
        <p className="text-muted-foreground">从已审核的图片或视频创建受控发布任务。</p>
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
