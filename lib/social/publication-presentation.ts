import { parseObservationHttpFailure } from "../../ops/browser-node/observation-diagnostics.mjs";
import { parsePublicationPreclickFailure } from "../../ops/browser-node/publication-diagnostics.mjs";

export type PublicationStepId =
  | "queued"
  | "browser"
  | "account"
  | "media"
  | "prepare"
  | "publish"
  | "done";

export type PublicationStepStatus = "completed" | "active" | "pending" | "failed" | "warning";

export type PublicationStep = {
  id: PublicationStepId;
  label: string;
  status: PublicationStepStatus;
  detail?: string;
};

export type PublicationStepProgress = {
  steps: PublicationStep[];
  completedSteps: number;
  totalSteps: number;
  percent: number;
  currentLabel: string;
  tone: "progressing" | "complete" | "failed" | "warning";
};

export type PublicationProgressInput = {
  format: string;
  status: string;
  jobStatus?: string | null;
  failureCode?: string | null;
  humanConfirmed?: boolean;
  hasAuthorization?: boolean;
  runStatus?: string | null;
  executionStage?: string | null;
};

function stepDefinitions(isText: boolean): Array<{ id: PublicationStepId; label: string }> {
  const base: Array<{ id: PublicationStepId; label: string }> = [
    { id: "queued", label: "提交排队" },
    { id: "browser", label: "启动浏览器与代理校验" },
    { id: "account", label: "打开主页与核对身份" },
  ];
  if (!isText) base.push({ id: "media", label: "拉取并校验发布素材" });
  base.push(
    { id: "prepare", label: "准备编辑器与核对预览" },
    { id: "publish", label: "提交发布与观察回执" },
    { id: "done", label: "平台回执已确认" },
  );
  return base;
}

function stageToStepId(
  stage: string | null | undefined,
  isText: boolean,
): PublicationStepId | null {
  switch (stage) {
    case "launch":
      return "browser";
    case "open":
    case "identity":
    case "baseline":
      return "account";
    case "media":
      return isText ? "prepare" : "media";
    case "prepare":
    case "preview":
    case "authorize":
    case "recheck":
    case "authorization_deadline":
      return "prepare";
    case "publish":
    case "observe":
    case "validate":
      return "publish";
    default:
      return null;
  }
}

const activeStepDetails: Record<PublicationStepId, string> = {
  queued: "等待托管节点领取任务",
  browser: "正在创建隔离浏览器与出口检查",
  account: "正在核对账号登录态与基线帖子",
  media: "正在拉取并校验私有媒体文件",
  prepare: "正在填充配文、附件与受众设置",
  publish: "正在等待平台返回发布回执",
  done: "正在保存平台回执",
};

export function publicationStepProgress(input: PublicationProgressInput): PublicationStepProgress {
  const isText = input.format === "text";
  const defs = stepDefinitions(isText);
  const totalSteps = defs.length;
  const finish = (
    steps: PublicationStep[],
    currentLabel: string,
    tone: PublicationStepProgress["tone"],
  ): PublicationStepProgress => {
    const completedSteps = steps.filter((step) => step.status === "completed").length;
    return {
      steps,
      completedSteps,
      totalSteps,
      percent: Math.round((completedSteps / totalSteps) * 100),
      currentLabel,
      tone,
    };
  };

  if (input.status === "published") {
    return finish(
      defs.map((def) => ({
        ...def,
        status: "completed" as const,
        ...(def.id === "done"
          ? { detail: input.humanConfirmed ? "已由人工核对确认" : "已取得平台回执链接" }
          : {}),
      })),
      "已完成全部步骤",
      "complete",
    );
  }

  if (input.status === "unknown") {
    const publishIndex = defs.findIndex((def) => def.id === "publish");
    return finish(
      defs.map((def, index) => ({
        ...def,
        status: index < publishIndex ? "completed" : index === publishIndex ? "warning" : "pending",
        ...(def.id === "publish" ? { detail: "未能取得可验证回执，需人工核对" } : {}),
      })),
      `第 ${publishIndex + 1}/${totalSteps} 步待核对（${defs[publishIndex].label}）`,
      "warning",
    );
  }

  if (["failed", "rejected", "paused", "cancelled"].includes(input.status)) {
    const preclick = parsePublicationPreclickFailure(input.failureCode);
    const failedStepId: PublicationStepId =
      stageToStepId(preclick?.stage, isText) ??
      (input.failureCode === "fleet_publication_preflight_rejected"
        ? "queued"
        : stageToStepId(input.executionStage, isText)) ??
      (input.failureCode === "fleet_publication_not_authorized" || input.jobStatus === "claimed"
        ? "browser"
        : "queued");
    const failedIndex = Math.max(
      0,
      defs.findIndex((def) => def.id === failedStepId),
    );
    const unsent =
      preclick !== null ||
      input.failureCode === "fleet_publication_not_authorized" ||
      input.failureCode === "fleet_publication_preflight_rejected";
    return finish(
      defs.map((def, index) => ({
        ...def,
        status: index < failedIndex ? "completed" : index === failedIndex ? "failed" : "pending",
        ...(index === failedIndex
          ? { detail: unsent ? "在此步骤中止，未向平台发送" : "在此步骤中止" }
          : {}),
      })),
      `在「${defs[failedIndex].label}」中止`,
      "failed",
    );
  }

  const executionStep = stageToStepId(input.executionStage, isText);
  const activeStepId: PublicationStepId =
    input.hasAuthorization || executionStep === "publish"
      ? "publish"
      : executionStep === "prepare" || executionStep === "media" || executionStep === "account"
        ? executionStep
        : input.runStatus === "running"
          ? "account"
          : input.jobStatus === "claimed" ||
              input.jobStatus === "running" ||
              input.runStatus === "starting" ||
              executionStep === "browser"
            ? "browser"
            : "queued";
  const activeIndex = Math.max(
    0,
    defs.findIndex((def) => def.id === activeStepId),
  );
  return finish(
    defs.map((def, index) => ({
      ...def,
      status: index < activeIndex ? "completed" : index === activeIndex ? "active" : "pending",
      ...(index === activeIndex
        ? {
            detail:
              def.id === "publish" && input.hasAuthorization
                ? "已授权点击发布，正在等待平台回执"
                : activeStepDetails[def.id],
          }
        : {}),
    })),
    `正在执行第 ${activeIndex + 1}/${totalSteps} 步：${defs[activeIndex].label}`,
    "progressing",
  );
}

/** Presentation only: publishing and retries remain governed by the domain service. */
export function publicationProgress(
  status: string,
  humanConfirmed = false,
  jobStatus?: string | null,
) {
  if (["submitted", "pending", "queued"].includes(status)) {
    if (jobStatus === "running" || jobStatus === "claimed")
      return { label: "执行中", detail: "发布服务正在处理，尚未取得成功回执。请勿重复提交。" };
    return { label: "待执行", detail: "发布任务已提交，等待服务执行。提交成功不代表已发布。" };
  }
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
        detail: "发布未完成。请查看此账号的处理提示；系统仅允许重试已确认未发送的任务。",
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
  fleet_publication_not_authorized:
    "发布服务在提交前中止，本次未发送。您的发布确认已收到，无需重复授权；故障处理后可重新预览并重试。",
  fleet_publication_preflight_rejected:
    "内容、素材或账号状态已变化，本次未发送。请返回当前内容查看最新状态。",
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
  const preparation = parsePublicationPreclickFailure(failureCode);
  if (preparation) {
    const details: Record<string, string> = {
      facebook_composer_transition_timeout: "发帖编辑器或受众设置未能在规定时间内就绪",
      facebook_composer_ready_timeout: "发帖编辑器未能在规定时间内就绪",
      facebook_audience_picker_timeout: "无法识别公开发布选项",
      facebook_audience_selection_timeout: "公开发布选项未能完成选择",
      facebook_audience_applied_timeout: "公开发布设置未能生效",
      publication_preview_text_mismatch: "编辑器中的正文与预览不一致",
      publication_attachment_mismatch: "编辑器中的附件与预览不一致",
      facebook_matching_post_already_exists:
        "目标账号主页已存在完全相同的正文帖子，请更换新配文后重新提交",
      facebook_video_caption_required: "该账号的视频发布要求附带已批准配文，请先选择配文后再提交",
      facebook_upload_failed: "浏览器未能将发布素材附加到发帖编辑器",
      publication_media_response_invalid: "平台返回发布素材响应无效，请稍后重试",
      publication_media_transport_failed: "拉取发布素材时传输失败，请稍后重试",
    };
    const stages: Record<string, string> = {
      open: "打开发布页面",
      identity: "核对账号身份",
      baseline: "检查已有帖子",
      media: "准备发布素材",
      prepare: "准备发帖编辑器",
      preview: "核对发布内容",
      authorize: "检查执行条件",
      recheck: "复核发布内容",
      authorization_deadline: "检查执行时限",
    };
    return `本次未发送：${details[preparation.code] ?? `${stages[preparation.stage]}时中止`}。您的发布确认已收到，无需重复授权。`;
  }
  const http = parseObservationHttpFailure(failureCode);
  if (http)
    return `浏览器观察 HTTP ${http.httpStatus}（${http.request} / ${http.step} / ${http.code}）`;
  if (!failureCode || !Object.hasOwn(publicationFailureLabels, failureCode)) return null;
  return publicationFailureLabels[failureCode];
}
