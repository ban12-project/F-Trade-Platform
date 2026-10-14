import { parseObservationHttpFailure } from "../../ops/browser-node/observation-diagnostics.mjs";

/** Presentation only: publishing and retries remain governed by the domain service. */
export function publicationProgress(status: string, humanConfirmed = false) {
  switch (status) {
    case "published":
      if (humanConfirmed)
        return {
          label: "已发布（人工核对）",
          detail: "节点所有者已核对实际帖子并确认结果；原未知回执保留，渠道不会自动恢复。",
        };
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

const publicationFailureLabels: Record<string, string> = {
  publication_publish_unknown: "发布步骤未取得可验证回执",
  publication_observe_unknown: "新帖子观察未完成",
  publication_observe_composer_pending: "发布编辑器未在观察期限内关闭",
  publication_observe_identity_unavailable: "回执页面账号身份未就绪",
  publication_observe_feed_unavailable: "回执页面未就绪",
  publication_observe_feed_empty: "回执页面尚未加载帖子",
  publication_observe_link_resolution_failed: "帖子链接解析失败",
  publication_observe_link_unresolved: "未取得规范帖子链接",
  publication_observe_navigation_failed: "回执页面导航失败",
  publication_observe_page_contract_failed: "回执页面结构核对失败",
  publication_observe_response_invalid: "浏览器观察响应无效",
  publication_observe_post_ambiguous: "出现多个匹配帖子",
  publication_observe_video_ambiguous: "匹配帖子中的视频不唯一",
  publication_observe_video_unverified: "未核对到匹配视频及规范 Reel 链接",
  publication_observe_matching_post_missing: "回执页面未找到完整配文匹配的新帖",
  publication_observe_baseline_only: "匹配帖子属于发布前已有记录",
  publication_observe_receipt_identity_mismatch: "配文匹配帖子的账号身份不一致",
  publication_observe_video_missing: "匹配新帖中的视频尚未核对到",
  publication_observe_reel_link_unverified: "匹配新帖尚未取得规范 Reel 链接",
  publication_observe_post_unverified: "未核对到匹配帖子",
  publication_observe_review_expired: "页面审核范围已到期",
  publication_observe_cancelled: "观察期间任务被停止",
  publication_observe_request_timeout: "浏览器观察请求超时",
  publication_observe_transport_failed: "浏览器观察传输失败",
  publication_validate_unknown: "帖子链接或内容校验未完成",
  publication_observation_unknown: "帖子观察结果不确定",
  external_result_unknown: "未收到可验证的平台结果",
  fleet_publication_result_unknown: "节点停止时仍未收到平台结果",
};

/** Fixed codes only. Unknown legacy strings stay internal instead of being
 * rendered as if they were trusted diagnostics. */
export function publicationFailureLabel(failureCode?: string | null) {
  const http = parseObservationHttpFailure(failureCode);
  if (http)
    return `浏览器观察 HTTP ${http.httpStatus}（${http.request} / ${http.step} / ${http.code}）`;
  if (!failureCode || !Object.hasOwn(publicationFailureLabels, failureCode)) return null;
  return publicationFailureLabels[failureCode];
}
