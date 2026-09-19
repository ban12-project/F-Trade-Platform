/** Presentation only: publishing and retries remain governed by the domain service. */
export function publicationProgress(status: string) {
  switch (status) {
    case "published":
      return { label: "已发布", detail: "已收到平台成功回执，可以查看发布凭证。" };
    case "submitted":
    case "pending":
    case "pending_verification":
    case "queued":
    case "publishing":
      return {
        label: "等待平台回执",
        detail: "系统正在处理，尚未确认发布成功。请等待结果，无需重复提交。",
      };
    case "unknown":
      return {
        label: "结果待人工核对",
        detail: "平台结果不确定，渠道已暂停。请由渠道管理员核对实际页面和回执，系统不会自动重试。",
      };
    case "failed":
    case "rejected":
      return {
        label: "发布失败",
        detail: "请由渠道管理员核对失败原因与平台实际结果。当前任务不会自动重试。",
      };
    case "paused":
    case "blocked":
      return {
        label: "发布已暂停",
        detail: "请由渠道管理员核对渠道状态。恢复后仍需重新预览并人工确认。",
      };
    case "cancelled":
      return { label: "发布已取消", detail: "本次发布已取消，没有成功发布的确认。" };
    default:
      return {
        label: "发布状态待核对",
        detail: "请由渠道管理员核对这条发布记录，不能据此认定发布成功。",
      };
  }
}
