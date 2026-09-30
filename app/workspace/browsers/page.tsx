import { buttonVariants } from "@/components/ui/button";
import { WorkspaceLink } from "@/components/workspace/workspace-link";
export default function Page() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">浏览器管理入口已迁移</h1>
      <p>账户、渠道和浏览器管理已统一到设置。发布请打开具体图文或视频，核对最终载荷并逐帖确认。</p>
      <WorkspaceLink
        href="/workspace/settings?section=channels"
        className={buttonVariants({ variant: "outline" })}
      >
        打开渠道设置
      </WorkspaceLink>
      <WorkspaceLink href="/workspace/content" className={buttonVariants({ variant: "outline" })}>
        打开内容与发布
      </WorkspaceLink>
    </main>
  );
}
