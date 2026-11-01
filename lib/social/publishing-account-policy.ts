import type { Account, FleetState } from "@/lib/browser-fleet/policy";
import { publicationScopeActive } from "@/lib/browser-fleet/policy";

export const publishingBlockers = {
  binding: "账号关联缺失，请由管理员核对已有账号配置。",
  grant: "账号授权已停用，请先启用账号授权。",
  unknown: "上次结果待核实，请先查看实际帖子并记录核实结果，避免重复发布。",
  login: "登录尚未验证，请完成登录或安全验证，再确认登录有效。",
  paused: "发布因异常暂停，请处理原因并人工恢复。",
  disabled: "尚未允许发布，请在账号设置中允许发布。",
  offline: "发布服务未连接，请由管理员检查服务器连接。",
  configuration: "账号的固定网络出口尚未配置，请补全高级设置。",
  capability: "这个账号尚未接通发布。请打开“完成登录 / 处理异常”，连接页面后完成发布功能核对。",
  scope: "这个账号的发布配置尚未生效或已过期。请打开接管页面，重新核对并让配置生效。",
} as const;
export type PublishingBlocker = keyof typeof publishingBlockers;
export type PublishingAccount = {
  recoveryHref?: string;
  textOnly?: boolean;
  audience?: string;
  id: string;
  nodeId: string | null;
  name: string;
  platform: string;
  channelRef: string;
  accountRef: string;
  authorizationEnabled: boolean;
  loginState: string;
  credentialsSaved: boolean;
  publicationEnabled: boolean;
  publicationPaused: boolean;
  blockers: PublishingBlocker[];
  ready: boolean;
};
export function publishingAccountReadiness(
  input: {
    id: string;
    nodeId: string | null;
    channelRef: string;
    accountRef: string;
    account?: Account;
    state?: FleetState;
    nodeStatus?: string;
    control?: { enabled: boolean; circuitStatus: string; pauseReason: string | null };
  },
  now = Date.now(),
): PublishingAccount {
  const { account, state, control } = input;
  const blockers: PublishingBlocker[] = [];
  if (!account || !state) blockers.push("binding");
  else {
    if (!account.enabled) blockers.push("grant");
    if (account.authState === "result_unknown") blockers.push("unknown");
    else if (account.authState !== "ready") blockers.push("login");
  }
  const publicationPaused =
    !!control &&
    control.circuitStatus !== "active" &&
    ![null, "not_enabled", "manual_pause"].includes(control.pauseReason);
  if (publicationPaused) blockers.push("paused");

  if (state && account) {
    if (
      input.nodeStatus !== "active" ||
      !state.lastSeenAt ||
      now - state.lastSeenAt > 90_000 ||
      !state.installationId ||
      !state.bootId
    )
      blockers.push("offline");
    if (!account.expectedEgressIp || !account.proxyCiphertext) blockers.push("configuration");
    if (!state.capabilities.includes("publish")) blockers.push("capability");
    else if (!publicationScopeActive(state, account, now)) blockers.push("scope");
  }
  if (!publicationPaused && (!control?.enabled || control.circuitStatus !== "active"))
    blockers.push("disabled");
  return {
    id: input.id,
    nodeId: input.nodeId,
    channelRef: input.channelRef,
    accountRef: input.accountRef,
    name: account?.displayName || input.accountRef,
    platform: input.channelRef.startsWith("facebook") ? "Facebook" : "社交平台（待核对）",
    authorizationEnabled: !!account?.enabled,
    loginState: account?.authState ?? "needs_login",
    credentialsSaved: !!account?.loginCiphertext,
    publicationEnabled: !!control?.enabled && control.circuitStatus === "active",
    audience: state?.publicationScopes?.find(
      (p) => p.channelRef === input.channelRef && p.accountRef === input.accountRef,
    )?.audience,
    textOnly:
      state?.publicationScopes?.some(
        (p) =>
          p.channelRef === input.channelRef &&
          p.accountRef === input.accountRef &&
          p.textOnly === true,
      ) ?? false,
    publicationPaused,
    blockers,
    ready: blockers.length === 0,
  };
}
export function publishingAccountLabel(account: PublishingAccount) {
  return `${account.platform} · ${account.name} · ${account.ready ? "可以提交发布" : publishingBlockers[account.blockers[0]]}`;
}
export class PublishingAccountUnavailableError extends Error {}
