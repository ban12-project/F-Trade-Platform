"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BrowserViewer } from "@/components/workspace/browser-viewer";
import {
  BrowserViewerWindow,
  openViewerWindow,
  type ViewerWindow,
  viewerWindowIsOpen,
} from "@/components/workspace/browser-viewer-window";
import { InteractiveSessionTimer } from "@/components/workspace/interactive-session-timer";
import { PublicationPageInspectionPanel } from "@/components/workspace/publication-page-inspection-panel";
import { SandboxStatus } from "@/components/workspace/sandbox-status";
import { browserNodeCommandAction, browserNodesAction } from "@/lib/actions/browser-nodes";
import {
  accountFormSchema,
  nodeFormSchema,
  ownerCommandSchema,
} from "@/lib/browser-fleet/contracts";
import { useWorkspaceDirty } from "./dirty-state";

type Nodes = Awaited<ReturnType<typeof browserNodesAction>>;
type Connection = {
  nodeId: string;
  runId: string;
  token: string;
  origin: string;
  expiresAt: number;
};
const emptyCredentials = {
  loginUsername: "",
  loginPassword: "",
  totpSecret: "",
  messengerPin: "",
  clearTotp: false,
  clearPin: false,
  proxyHost: "",
  proxyPort: "",
  proxyUsername: "",
  proxyPassword: "",
  clearLogin: false,
  clearProxy: false,
};
const stateLabels: Record<string, string> = {
  queued: "排队中",
  starting: "正在启动",
  running: "运行中",
  stopping: "正在释放",
  quarantined: "等待节点确认已停止",
  completed: "已释放",
  failed: "未完成",
  unknown: "结果未知",
  ready: "登录已验证",
  needs_login: "需要登录",
  needs_2fa: "需要 2FA",
  checkpoint: "需要安全验证",
  page_contract_failed: "页面规则需重新核对，后台已暂停",
  egress_mismatch: "固定出口校验失败",
  result_unknown: "需要核对未知结果",
};
export function BrowserNodesPanel() {
  const [nodes, setNodes] = useState<Nodes>([]);
  const [editingAccount, setEditingAccount] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [viewerWindow, setViewerWindow] = useState<ViewerWindow | null>(null);
  const nodeForm = useForm<z.infer<typeof nodeFormSchema>>({
    resolver: zodResolver(nodeFormSchema),
    defaultValues: {
      name: "",
      gatewayOrigin: "",
      maxBrowsers: 1,
      memoryBudgetMb: 3072,
      browserMemoryMb: 2048,
    },
  });
  const accountForm = useForm<z.infer<typeof accountFormSchema>>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      nodeId: "",
      channelRef: "facebook-personal",
      accountRef: `account-${crypto.randomUUID()}`,
      displayName: "",
      expectedEgressIp: "",
      pollSeconds: 900,
      credentials: emptyCredentials,
    },
  });
  useWorkspaceDirty("channel-node", nodeForm.formState.isDirty);
  useWorkspaceDirty("channel-account", accountForm.formState.isDirty);
  useEffect(() => {
    let disposed = false;
    let loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const rows = await browserNodesAction();
        if (!disposed) setNodes(rows);
      } catch {
        if (!disposed) setMessage("无法读取发布服务，请重试或联系管理员检查配置。");
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(() => setKey(null), 120_000);
    return () => clearTimeout(timer);
  }, [key]);
  async function send(input: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const result = await browserNodeCommandAction(input);
      if (!result.ok) {
        setMessage(result.message);
        return null;
      }
      if (result.result.accessKey) setKey(result.result.accessKey);
      setNodes(await browserNodesAction());
      setMessage(
        result.result.deadline
          ? "接管已延长 30 分钟；发布核对有效期保持不变。"
          : "操作已记录，正在等待发布服务同步；请以账号实际状态为准。",
      );
      return result.result;
    } catch {
      setMessage("请求未完成，请先查看节点和排队记录，避免重复操作。");
      return null;
    } finally {
      setBusy(false);
    }
  }
  const connectedNode = nodes.find((node) => node.id === connection?.nodeId);
  const connectedRun = connectedNode?.runs.find((run) => run.id === connection?.runId);
  const connectedAccount = connectedNode?.accounts.find(
    (account) => account.id === connectedRun?.accountId,
  );
  const loginScope = connectedNode?.loginFillScopes.find(
    (scope) =>
      scope.channelRef === connectedAccount?.channelRef &&
      scope.accountRef === connectedAccount?.accountRef,
  );
  const automaticLogin = connectedRun?.savedLoginAutomatic ?? loginScope?.automatic ?? false;
  const canFillLogin =
    connectedNode?.status === "active" &&
    connectedRun?.kind === "interactive" &&
    connectedRun.status === "running" &&
    connectedRun.ticketUsed &&
    !connectedRun.stopRequested &&
    !connectedRun.savedLoginState &&
    connectedAccount?.enabled &&
    connectedAccount.loginSaved &&
    !!loginScope;
  const loginUnavailable =
    connectedNode?.status !== "active" ||
    connectedRun?.status !== "running" ||
    connectedRun.stopRequested
      ? "当前浏览器任务不可用，请核对任务状态后重新接入。"
      : !connectedAccount?.enabled
        ? "该账号授权已停用，请先核对账号授权。"
        : !connectedAccount.loginSaved
          ? "该账号尚未保存登录凭据，请在账号配置中保存。"
          : !loginScope
            ? "该账号没有有效的登录页面规则（尚未启用或已过期），请先核对节点配置。"
            : !connectedRun.ticketUsed
              ? "正在等待远程桌面接入，连接建立后即可使用已保存凭据。"
              : null;
  const challengeStatus = connectedRun?.savedLoginChallenge
    ? {
        checkpoint: connectedRun.savedLoginOutcome
          ? "Facebook 要求额外的人机或设备验证。请人工完成验证后重新接入；本次未自动重试。"
          : "请在远程页面完成人机或设备验证，程序将在本次授权有效期内自动继续。",
        rejected: "Facebook 拒绝了本次验证。请核对账号凭据及验证设置后重新接入。",
        unsupported_factor: "当前验证方式无法自动处理。请人工完成验证后重新接入。",
      }[connectedRun.savedLoginChallenge]
    : null;
  const factorStatus = connectedRun?.savedLoginFactorPrompts?.length
    ? `本次恢复请求了 ${connectedRun.savedLoginFactorPrompts.join("、")}。`
    : connectedRun?.savedLoginFactorPrompts
      ? "本次未请求密码、TOTP 或 PIN。"
      : "本次未记录登录验证步骤。";
  const historyStatus =
    connectedRun?.savedLoginHistoryEvidence === "threads"
      ? "已观察到聊天条目，但这不代表完整历史已恢复。"
      : connectedRun?.savedLoginHistoryEvidence === "empty_inbox"
        ? "当前为空收件箱，不能作为历史恢复或 DM 采集通过。"
        : "尚未形成历史恢复证据。";
  const loginStatus =
    challengeStatus ??
    (connectedRun?.savedLoginOutcome === "ready"
      ? `已自动完成账号身份与 Messenger 界面验证。${factorStatus}${historyStatus}`
      : connectedRun?.savedLoginOutcome === "filled"
        ? "已填入，请在远程页面完成登录和 2FA。"
        : connectedRun?.savedLoginOutcome === "refused"
          ? "登录操作已拒绝，请检查账号状态和登录页面规则。"
          : connectedRun?.savedLoginOutcome === "unknown"
            ? "登录结果未知，本次不再重试。请重新接入后核对。"
            : connectedRun?.savedLoginState
              ? automaticLogin
                ? "自动登录请求已记录，正在等待账号身份与 Messenger 验证结果。"
                : "填充请求已记录，正在等待节点结果。"
              : (loginUnavailable ??
                (automaticLogin
                  ? "将先核对现有会话；需要恢复时会提交已保存密码及受支持的 2FA/PIN。遇到真人验证会暂停等待处理。"
                  : "仅填入已保存的账号和密码；请在远程页面检查并提交登录。")));
  return (
    <div className="space-y-6">
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
      {key && (
        <Card>
          <CardHeader>
            <CardTitle>节点 Access Key，仅本次显示</CardTitle>
            <CardDescription>
              一台 VPS 使用一个 Key，自动同步该节点被授权的全部账号。不要共享给其他 VPS，不要填入
              NEXT_PUBLIC_*。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="block break-all select-all">{key}</code>
            <Button type="button" variant="outline" onClick={() => setKey(null)}>
              我已保存，隐藏 Key
            </Button>
          </CardContent>
        </Card>
      )}
      <Collapsible>
        <CollapsibleTrigger render={<Button variant="outline" />}>
          高级：连接节点与容量
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>连接自管服务器</CardTitle>
              <CardDescription>
                设置这台 VPS 的容量。平台不按账号数量启动浏览器，只有排队任务获得租约后才启动。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={nodeForm.handleSubmit(async (value) => {
                  if (await send({ operation: "create", value })) nodeForm.reset();
                })}
              >
                {(
                  [
                    ["name", "节点名称"],
                    ["gatewayOrigin", "接管域名，例如 https://browser-a.example.com"],
                  ] as const
                ).map(([name, label]) => (
                  <Field key={name}>
                    <FieldLabel htmlFor={`node-${name}`}>{label}</FieldLabel>
                    <Input id={`node-${name}`} {...nodeForm.register(name)} disabled={busy} />
                    <FieldError errors={[nodeForm.formState.errors[name]]} />
                  </Field>
                ))}
                {(
                  [
                    ["maxBrowsers", "最大同时运行数"],
                    ["memoryBudgetMb", "浏览器总内存预算（MiB）"],
                    ["browserMemoryMb", "单浏览器内存上限（MiB）"],
                  ] as const
                ).map(([name, label]) => (
                  <Field key={name}>
                    <FieldLabel htmlFor={`node-${name}`}>{label}</FieldLabel>
                    <Input
                      id={`node-${name}`}
                      type="number"
                      {...nodeForm.register(name, { valueAsNumber: true })}
                      disabled={busy}
                    />
                    <FieldError errors={[nodeForm.formState.errors[name]]} />
                  </Field>
                ))}
                <Button type="submit" disabled={busy}>
                  创建节点并生成 Key
                </Button>
              </form>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
      <Card>
        <CardHeader>
          <CardTitle>添加或更新发布账号</CardTitle>
          <CardDescription>
            选择已有账号会带出原有绑定；添加账号时系统生成固定标识。名称可以修改，账号不能跨服务重复绑定。保存凭据后需要重新验证登录，发布开关保持原状。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field className="mb-4">
            <FieldLabel htmlFor="configured-account">选择已有账号或添加账号</FieldLabel>
            <Select
              items={Object.fromEntries([
                ["new", "添加新账号"],
                ...nodes.flatMap((n) =>
                  n.accounts.map((a) => [
                    a.id,
                    `Facebook · ${a.displayName || a.accountRef}（${n.name}）`,
                  ]),
                ),
              ])}
              value={editingAccount}
              onValueChange={(value) => {
                const selected = nodes
                  .flatMap((n) => n.accounts.map((a) => ({ node: n, account: a })))
                  .find(({ account }) => account.id === value);
                setEditingAccount(value ?? "");
                accountForm.reset(
                  selected
                    ? {
                        nodeId: selected.node.id,
                        channelRef: selected.account.channelRef,
                        accountRef: selected.account.accountRef,
                        displayName: selected.account.displayName || selected.account.accountRef,
                        expectedEgressIp: selected.account.expectedEgressIp ?? "",
                        pollSeconds: selected.account.pollSeconds,
                        credentials: emptyCredentials,
                      }
                    : {
                        nodeId: nodes.length === 1 ? nodes[0].id : "",
                        channelRef: "facebook-personal",
                        accountRef: `account-${crypto.randomUUID()}`,
                        displayName: "",
                        expectedEgressIp: "",
                        pollSeconds: 900,
                        credentials: emptyCredentials,
                      },
                );
              }}
            >
              <SelectTrigger id="configured-account">
                <SelectValue placeholder="添加新账号" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="new">添加新账号</SelectItem>
                  {nodes.flatMap((n) =>
                    n.accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        Facebook · {a.displayName || a.accountRef}（{n.name}）
                      </SelectItem>
                    )),
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {!nodes.length && (
            <p className="mb-4 text-sm">
              尚未连接发布服务，请先展开上方“高级：连接节点与容量”，由管理员完成连接。
            </p>
          )}
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={accountForm.handleSubmit(async (value) => {
              const result = await send({
                operation: "grant",
                value: {
                  ...value,
                  accountRef: value.accountRef || `account-${crypto.randomUUID()}`,
                },
              });
              if (result) {
                accountForm.reset({ ...value, credentials: emptyCredentials });
                if (result.accountId) setEditingAccount(result.accountId);
              }
            })}
          >
            <Field>
              <FieldLabel htmlFor="account-displayName">账号名称（方便团队识别）</FieldLabel>
              <Input
                id="account-displayName"
                {...accountForm.register("displayName")}
                disabled={busy}
              />
              <FieldError errors={[accountForm.formState.errors.displayName]} />
              <FieldDescription>
                平台：Facebook。首次添加需由管理员配置下方发布服务和固定代理。
              </FieldDescription>
            </Field>
            <Collapsible className="sm:col-span-2" defaultOpen={!editingAccount}>
              <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
                高级：发布服务与网络出口
              </CollapsibleTrigger>
              <CollapsibleContent className="grid gap-4 pt-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>目标节点</FieldLabel>
                  <Controller
                    control={accountForm.control}
                    name="nodeId"
                    render={({ field }) => (
                      <Select
                        items={Object.fromEntries(
                          nodes.filter((n) => n.status === "active").map((n) => [n.id, n.name]),
                        )}
                        value={field.value}
                        onValueChange={(v) => field.onChange(v ?? "")}
                        disabled={busy || (!!editingAccount && editingAccount !== "new")}
                      >
                        <SelectTrigger aria-label="目标节点">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {nodes
                            .filter((n) => n.status === "active")
                            .map((n) => (
                              <SelectItem key={n.id} value={n.id}>
                                {n.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[accountForm.formState.errors.nodeId]} />
                </Field>
                {([["expectedEgressIp", "预期固定出口 IP（由代理服务商确认）"]] as const).map(
                  ([name, label]) => (
                    <Field key={name} data-invalid={!!accountForm.formState.errors[name]}>
                      <FieldLabel htmlFor={`account-${name}`}>{label}</FieldLabel>
                      <Input
                        id={`account-${name}`}
                        {...accountForm.register(name)}
                        aria-invalid={!!accountForm.formState.errors[name]}
                        disabled={busy}
                      />
                      <FieldError errors={[accountForm.formState.errors[name]]} />
                    </Field>
                  ),
                )}
                <Field>
                  <FieldLabel htmlFor="account-poll">收件箱检查间隔（秒，0 为停用）</FieldLabel>
                  <Input
                    id="account-poll"
                    type="number"
                    {...accountForm.register("pollSeconds", { valueAsNumber: true })}
                    disabled={busy}
                  />
                  <FieldError errors={[accountForm.formState.errors.pollSeconds]} />
                </Field>
              </CollapsibleContent>
            </Collapsible>
            {(
              [
                ["loginUsername", "Facebook 登录名（可选）"],
                ["loginPassword", "Facebook 密码（可选，加密保存）"],
                ["totpSecret", "2FA Base32 密钥（可选，加密保存）"],
                ["messengerPin", "Messenger PIN（可选，加密保存）"],
              ] as const
            ).map(([name, label]) => (
              <Field key={name}>
                <FieldLabel htmlFor={`credential-${name}`}>{label}</FieldLabel>
                <Input
                  id={`credential-${name}`}
                  type={
                    name.endsWith("Password") || name === "totpSecret" || name === "messengerPin"
                      ? "password"
                      : "text"
                  }
                  autoComplete="off"
                  {...accountForm.register(`credentials.${name}`)}
                  disabled={busy}
                />
                <FieldError errors={[accountForm.formState.errors.credentials?.[name]]} />
              </Field>
            ))}
            <Collapsible className="sm:col-span-2">
              <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
                高级：固定代理
              </CollapsibleTrigger>
              <CollapsibleContent className="grid gap-4 pt-4 sm:grid-cols-2">
                {(
                  [
                    ["proxyHost", "固定 HTTP 代理主机"],
                    ["proxyPort", "代理端口"],
                    ["proxyUsername", "代理用户名"],
                    ["proxyPassword", "代理密码"],
                  ] as const
                ).map(([name, label]) => (
                  <Field key={name}>
                    <FieldLabel htmlFor={`credential-${name}`}>{label}</FieldLabel>
                    <Input
                      id={`credential-${name}`}
                      type={
                        name.endsWith("Password") || ["totpSecret", "messengerPin"].includes(name)
                          ? "password"
                          : "text"
                      }
                      autoComplete="off"
                      {...accountForm.register(`credentials.${name}`)}
                      disabled={busy}
                    />
                    <FieldError errors={[accountForm.formState.errors.credentials?.[name]]} />
                  </Field>
                ))}
              </CollapsibleContent>
            </Collapsible>
            <FieldSet>
              <FieldLegend>清除已保存的凭据</FieldLegend>
              <FieldDescription>
                输入留空会保留原值。勾选后，在保存账号授权时清除。
              </FieldDescription>
              {(
                [
                  ["clearTotp", "清除已保存的 2FA 密钥"],
                  ["clearPin", "清除已保存的 Messenger PIN"],
                  ["clearLogin", "清除全部登录凭据及验证密钥"],
                ] as const
              ).map(([name, label]) => (
                <Field
                  key={name}
                  orientation="horizontal"
                  data-invalid={!!accountForm.formState.errors.credentials?.[name]}
                >
                  <Controller
                    control={accountForm.control}
                    name={`credentials.${name}`}
                    render={({ field }) => (
                      <Checkbox
                        id={`credential-${name}`}
                        checked={field.value ?? false}
                        onCheckedChange={field.onChange}
                        disabled={busy}
                        aria-invalid={!!accountForm.formState.errors.credentials?.[name]}
                      />
                    )}
                  />
                  <FieldLabel htmlFor={`credential-${name}`}>{label}</FieldLabel>
                  <FieldError errors={[accountForm.formState.errors.credentials?.[name]]} />
                </Field>
              ))}
            </FieldSet>
            <Button type="submit" disabled={busy || !nodes.length}>
              保存账号凭据
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            只有人工接管能力时，可以打开远程页面完成登录与核对。自动登录、收件箱同步和发布需要分别配置对应执行能力。保存密码不会完成登录或自动允许发布。
          </p>
        </CardContent>
      </Card>
      {nodes.map((node) => (
        <Card key={node.id}>
          <CardHeader>
            <CardTitle>
              {node.name}{" "}
              <Badge variant="outline">
                {node.status === "active" ? "服务授权有效" : "服务授权已撤销"}
              </Badge>
            </CardTitle>
            <CardDescription>
              最近连接 {node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : "尚未连接"} ·
              执行能力{" "}
              {node.capabilities
                .map(
                  (capability) =>
                    ({ interactive: "人工接管", inbox: "收件箱同步", publish: "发布执行" })[
                      capability
                    ],
                )
                .join("、") || "尚未报告"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SandboxStatus sandbox={node.sandbox} nodeId={node.id} />
            <Collapsible>
              <CollapsibleTrigger render={<Button variant="outline" />}>
                高级：节点授权
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-4">
                <p className="text-sm">
                  节点：{node.id} · 并发上限 {node.limits.maxBrowsers}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void send({ operation: "rotate", nodeId: node.id });
                    }}
                  >
                    轮换 Key，停止旧租约
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || node.status !== "active"}
                    onClick={() => {
                      void send({ operation: "revoke", nodeId: node.id });
                    }}
                  >
                    撤销节点授权
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>
            {node.accounts.map((account) => (
              <div
                id={`publishing-account-${account.id}`}
                key={account.id}
                className="scroll-mt-20 space-y-2 rounded-lg border p-3"
              >
                <p className="font-medium">
                  {account.displayName || account.accountRef}{" "}
                  <Badge variant="outline">
                    {stateLabels[account.authState] ?? account.authState}
                  </Badge>
                </p>
                <p className="text-sm text-muted-foreground">
                  代理 {account.proxySaved ? "已保存" : "未配置"} · 登录凭据{" "}
                  {account.loginSaved ? "已保存" : "未配置"} · 最近收件箱检查{" "}
                  {account.lastCheckedAt
                    ? new Date(account.lastCheckedAt).toLocaleString()
                    : "尚未执行"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={busy || !account.enabled || node.status !== "active"}
                    onClick={() => {
                      void send({ operation: "open", nodeId: node.id, accountId: account.id });
                    }}
                  >
                    完成登录 / 处理异常
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void send({
                        operation: "account",
                        nodeId: node.id,
                        accountId: account.id,
                        enabled: !account.enabled,
                      });
                    }}
                  >
                    {account.enabled ? "停用账号授权" : "启用账号授权"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void send({
                        operation: "confirm-login",
                        nodeId: node.id,
                        accountId: account.id,
                        confirmed: true,
                      });
                    }}
                  >
                    已核对账号及代理，确认登录有效
                  </Button>
                </div>
              </div>
            ))}
            <Collapsible>
              <CollapsibleTrigger render={<Button variant="ghost" />}>
                高级：执行队列
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-3">
                {node.runs
                  .filter((run) => run.kind !== "interactive")
                  .map((run) => (
                    <p key={run.id} className="text-sm">
                      {run.kind === "publish" ? "发布任务" : "收件箱同步"} ·{" "}
                      {stateLabels[run.status] ?? "等待处理"}
                    </p>
                  ))}
              </CollapsibleContent>
            </Collapsible>
            <div className="space-y-2">
              {node.runs
                .filter(
                  (r) =>
                    r.kind === "interactive" &&
                    [
                      "queued",
                      "starting",
                      "running",
                      "stopping",
                      "quarantined",
                      "unknown",
                    ].includes(r.status),
                )
                .map((run) => (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded border p-2"
                    key={run.id}
                  >
                    <Badge variant="outline">{stateLabels[run.status] ?? run.status}</Badge>
                    {run.deadline > 0 &&
                      ["starting", "running"].includes(run.status) &&
                      !run.stopRequested && (
                        <InteractiveSessionTimer
                          deadline={run.deadline}
                          serverNow={node.serverNow}
                          disabled={busy || run.status !== "running"}
                          onExtend={async (expectedDeadline) => {
                            const command = ownerCommandSchema.parse({
                              operation: "extend",
                              nodeId: node.id,
                              runId: run.id,
                              expectedDeadline,
                            });
                            return !!(await send(command));
                          }}
                        />
                      )}
                    {run.savedLoginChallenge === "checkpoint" && !run.savedLoginOutcome && (
                      <span role="status" className="text-sm">
                        等待人工验证，请接入远程页面；完成后自动继续。
                      </span>
                    )}
                    <span className="text-sm">
                      {node.accounts.find((a) => a.id === run.accountId)?.accountRef} · 登录操作
                    </span>
                    {run.kind === "interactive" &&
                      run.status === "running" &&
                      !run.stopRequested && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={async () => {
                            setConnection(null);
                            setViewerWindow(null);
                            const result = await send({
                              operation: "ticket",
                              nodeId: node.id,
                              runId: run.id,
                            });
                            if (result?.connection)
                              setConnection({
                                ...result.connection,
                                nodeId: node.id,
                                runId: run.id,
                              });
                          }}
                        >
                          {run.ticketUsed ? "重新授权连接" : "接入登录 / 2FA"}
                        </Button>
                      )}
                    {run.kind === "interactive" &&
                      run.status === "running" &&
                      !run.stopRequested && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={async () => {
                            const popup = openViewerWindow(node.gatewayOrigin);
                            if (!popup) {
                              setMessage(
                                "浏览器未能打开独立窗口。请允许本次弹出窗口后再次点击；尚未申请连接票据。",
                              );
                              return;
                            }
                            setConnection(null);
                            setViewerWindow(popup);
                            const result = await send({
                              operation: "ticket",
                              nodeId: node.id,
                              runId: run.id,
                            });
                            if (result?.connection && viewerWindowIsOpen(popup)) {
                              setConnection({
                                ...result.connection,
                                nodeId: node.id,
                                runId: run.id,
                              });
                            } else {
                              popup.window.close();
                              setViewerWindow(null);
                            }
                          }}
                        >
                          独立窗口接入
                        </Button>
                      )}
                    {run.kind === "interactive" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          void send({ operation: "stop", nodeId: node.id, runId: run.id });
                        }}
                      >
                        关闭并释放
                      </Button>
                    )}
                    {run.status === "running" && !run.stopRequested && (
                      <PublicationPageInspectionPanel nodeId={node.id} runId={run.id} />
                    )}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      ))}
      {connection && (
        <Card>
          <CardHeader>
            <CardTitle>独立浏览器接管</CardTitle>
            <CardDescription>
              每次接管 30 分钟，剩余不足 5 分钟时可人工延长。断线后保留 2
              分钟，可点击“重新授权连接”取得新票后重连（接管到期或授权失效时除外）。2FA
              直接在远程页面完成，不上传验证码。退出前请核对账号与固定代理出口。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {viewerWindow ? (
              <p role="status">接管画面已在独立窗口打开。</p>
            ) : (
              <BrowserViewer
                key={connection.token}
                origin={connection.origin}
                token={connection.token}
              />
            )}
            <div className="flex flex-col items-start gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || !canFillLogin}
                onClick={() => {
                  void send({
                    operation: "use-saved-login",
                    nodeId: connection.nodeId,
                    runId: connection.runId,
                    confirmed: true,
                  });
                }}
              >
                {automaticLogin ? "使用已保存凭据自动登录" : "填入已保存账号和密码"}
              </Button>
              <p role="status" className="text-sm text-muted-foreground">
                {loginStatus}
              </p>
            </div>
            <Button
              type="button"
              onClick={async () => {
                await send({
                  operation: "stop",
                  nodeId: connection.nodeId,
                  runId: connection.runId,
                });
                setConnection(null);
                setViewerWindow(null);
              }}
            >
              结束接管并释放浏览器
            </Button>
          </CardContent>
        </Card>
      )}
      {viewerWindow && (
        <BrowserViewerWindow
          popup={viewerWindow}
          onClosed={() => {
            setConnection(null);
            setViewerWindow(null);
            setMessage("独立窗口已关闭。继续操作前请核对当前任务，再重新授权连接。");
          }}
          connection={connection ? { origin: connection.origin, token: connection.token } : null}
        />
      )}
    </div>
  );
}
