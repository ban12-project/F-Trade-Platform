"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setupPublicationAction } from "@/lib/actions/browser-nodes";
import {
  type PublicationSetupResult,
  publicationSetupInputSchema,
} from "@/lib/browser-fleet/publication-setup-contract";

const reasons: Record<PublicationSetupResult["stage"], string> = {
  reviewed: "已保存这一步的核对结果。请继续下面尚未完成的步骤。",
  ready: "文字发布配置已生效。关闭接管页面后，在账号设置中允许发布；每条内容仍需单独确认。",
  entry: "尚未识别到发布入口。请返回 Facebook 首页，等页面加载后重试。",
  composer: "请打开空白的创建帖子窗口，等待正文框、发布按钮和可见范围显示后重试。",
  receipt:
    "请打开自己的个人主页，滚动到已有帖子（头像更新也可以）后重试。系统需要核对帖子作者和时间链接。",
  identity:
    "当前页面尚不能确认是这个账号。请检查登录身份；核对首页时回到首页，核对结果时打开自己的个人主页。",
  draft: "编辑器中有正文或媒体。请先自行保存或取消草稿，再打开空白编辑器核对。",
  audience: "暂不支持当前可见范围。请在 Facebook 页面明确选择公开、好友或仅自己，再重新核对。",
  page: "页面尚未就绪。请先连接远程浏览器并打开 Facebook。",
};
export function PublicationSetupPanel({ nodeId, runId }: { nodeId: string; runId: string }) {
  const pending = useRef(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<PublicationSetupResult>(),
    [message, setMessage] = useState("");
  async function perform(operation: "inspect" | "prepare" | "activate") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const value = publicationSetupInputSchema.parse({
        nodeId,
        runId,
        operation,
        ...(operation === "activate" ? { candidateHash: result?.candidateHash } : {}),
      });
      const response = await setupPublicationAction(value);
      if (response.ok) {
        setResult(response.result);
        setMessage(reasons[response.result.stage]);
      } else setMessage(response.message);
    } catch {
      setMessage("核对未完成，请重新核对当前页面。已打开的页面会保留。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>接通这个账号的发布功能</CardTitle>
        <CardDescription>
          连接远程浏览器并停在 Facebook
          首页。自动核对会查看账号、已有帖子并打开空白编辑器；不会填写内容、改变可见范围或发送帖子。无需编辑服务器配置。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>Facebook 首页：确认账号和创建帖子入口。{result?.entry ? " ✓ 已核对" : ""}</li>
          <li>个人主页：查看已有帖子，核对作者和时间链接。{result?.receipt ? " ✓ 已核对" : ""}</li>
          <li>
            回到首页，打开空白的创建帖子窗口，确认可见范围。{result?.composer ? " ✓ 已核对" : ""}
          </li>
        </ol>
        <p>
          当前支持：文字帖子。图片和视频尚未经过本次核对，不能作为已接通能力使用。核对结果在本次会话内保留
          10 分钟；生效后有效 7 天，过期需重新核对。
        </p>
        {result?.audience ? (
          <p>
            本次发布范围：
            {{ Public: "公开", Friends: "好友", "Only me": "仅自己" }[result.audience] ??
              result.audience}
            。配置会锁定这个范围，页面范围变化时将停止发布。
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => perform("prepare")}
          >
            自动核对发布功能（不发帖）
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => perform("inspect")}
          >
            {busy ? "正在核对…" : "核对当前页面并保存进度"}
          </Button>
          <Button
            type="button"
            disabled={busy || !result?.candidateHash || result.active}
            onClick={() => perform("activate")}
          >
            确认以上范围，让文字发布配置生效
          </Button>
        </div>
        {message ? <p role="status">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
