"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { browserNodeCommandAction, browserNodesAction } from "@/lib/actions/browser-nodes";
import { accountFormSchema, nodeFormSchema } from "@/lib/browser-fleet/contracts";

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
  ready: "已人工确认",
  needs_login: "需要登录",
  needs_2fa: "需要 2FA",
  checkpoint: "需要安全验证",
  result_unknown: "需要核对未知结果",
};
export function BrowserNodesPanel() {
  const [nodes, setNodes] = useState<Nodes>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
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
      accountRef: "",
      pollSeconds: 900,
      credentials: emptyCredentials,
    },
  });
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
        if (!disposed) setMessage("无法读取节点，请检查管理权限与数据库迁移。");
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
  useEffect(() => {
    if (!connection) return;
    const listener = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== connection.origin ||
        event.data?.type !== "ftrade-browser-ready"
      )
        return;
      frame.current?.contentWindow?.postMessage(
        { type: "ftrade-browser-ticket", token: connection.token },
        connection.origin,
      );
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [connection]);
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
      setMessage("操作已记录，节点将在下一次轮询时同步。");
      return result.result;
    } catch {
      setMessage("请求未完成，请先查看节点和排队记录，避免重复操作。");
      return null;
    } finally {
      setBusy(false);
    }
  }
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
      <Card>
        <CardHeader>
          <CardTitle>创建 Browser 节点</CardTitle>
          <CardDescription>
            设置这台 VPS 的容量。平台不按账号数量启动浏览器，只有排队任务获得租约后才启动。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={nodeForm.handleSubmit(async (value) => {
              await send({ operation: "create", value });
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
      <Card>
        <CardHeader>
          <CardTitle>授权账号与同步配置</CardTitle>
          <CardDescription>
            相同节点、渠道和账号标识再次保存即更新。凭据加密保存，留空保留原值；修改后停止该账号的旧租约。浏览器会话留在绑定
            VPS 的独立卷中。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={accountForm.handleSubmit(async (value) => {
              const result = await send({ operation: "grant", value });
              if (result) accountForm.reset({ ...value, credentials: emptyCredentials });
            })}
          >
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
                    disabled={busy}
                  >
                    <SelectTrigger>
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
            {(
              [
                ["channelRef", "渠道标识"],
                ["accountRef", "账号标识（固定不变）"],
              ] as const
            ).map(([name, label]) => (
              <Field key={name}>
                <FieldLabel htmlFor={`account-${name}`}>{label}</FieldLabel>
                <Input id={`account-${name}`} {...accountForm.register(name)} disabled={busy} />
                <FieldError errors={[accountForm.formState.errors[name]]} />
              </Field>
            ))}
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
            {(
              [
                ["loginUsername", "Facebook 登录名（可选）"],
                ["loginPassword", "Facebook 密码（可选，加密保存）"],
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
                  type={name.endsWith("Password") ? "password" : "text"}
                  autoComplete="off"
                  {...accountForm.register(`credentials.${name}`)}
                  disabled={busy}
                />
                <FieldError errors={[accountForm.formState.errors.credentials?.[name]]} />
              </Field>
            ))}
            <Button type="submit" disabled={busy || !nodes.length}>
              保存账号授权
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            默认节点仅包含人工接管。保存密码不代表已安装自动登录执行器；收件箱执行器未安装时不会显示虚假的“已同步”。
          </p>
        </CardContent>
      </Card>
      {nodes.map((node) => (
        <Card key={node.id}>
          <CardHeader>
            <CardTitle>
              {node.name} <Badge variant="outline">{node.status}</Badge>
            </CardTitle>
            <CardDescription>
              {node.id} · 并发上限 {node.limits.maxBrowsers} · 最近心跳{" "}
              {node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : "尚未连接"} · 执行能力{" "}
              {node.capabilities.join(", ") || "待节点报告"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
            {node.accounts.map((account) => (
              <div key={account.id} className="space-y-2 rounded-lg border p-3">
                <p className="font-medium">
                  {account.accountRef}{" "}
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
                    排队打开浏览器
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
            <div className="space-y-2">
              {node.runs
                .filter((r) =>
                  ["queued", "starting", "running", "stopping", "quarantined", "unknown"].includes(
                    r.status,
                  ),
                )
                .map((run) => (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded border p-2"
                    key={run.id}
                  >
                    <Badge variant="outline">{stateLabels[run.status] ?? run.status}</Badge>
                    <span className="text-sm">
                      {node.accounts.find((a) => a.id === run.accountId)?.accountRef} · {run.kind}
                    </span>
                    {run.kind === "interactive" && run.status === "running" && !run.ticketUsed && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          const result = await send({
                            operation: "ticket",
                            nodeId: node.id,
                            runId: run.id,
                          });
                          if (result?.connection)
                            setConnection({ ...result.connection, nodeId: node.id, runId: run.id });
                        }}
                      >
                        接入登录 / 2FA
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
              连接最长 10 分钟，断开后释放资源。2FA
              直接在远程页面完成，不上传验证码。退出前请核对账号与固定代理出口。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <iframe
              ref={frame}
              src={`${connection.origin}/viewer`}
              title="账号登录与两步验证"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin"
              className="h-[640px] w-full rounded border"
            />
            <Button
              type="button"
              onClick={async () => {
                await send({
                  operation: "stop",
                  nodeId: connection.nodeId,
                  runId: connection.runId,
                });
                setConnection(null);
              }}
            >
              结束接管并释放浏览器
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
