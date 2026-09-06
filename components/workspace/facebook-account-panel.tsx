"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  closeFacebookInteractiveAction,
  facebookAccountStatusAction,
  openFacebookInteractiveAction,
  resumeFacebookAccountAction,
  saveFacebookCredentialsAction,
} from "@/lib/actions/facebook-account";
import { facebookCredentialFormSchema } from "@/lib/social/facebook-account-forms";

type Values = z.infer<typeof facebookCredentialFormSchema>;
const empty: Values = {
  loginUsername: "",
  loginPassword: "",
  proxyHost: "",
  proxyPort: "",
  proxyUsername: "",
  proxyPassword: "",
  clearLogin: false,
  clearProxy: false,
};
const labels: Record<string, string> = {
  disconnected: "未连接",
  ready: "登录有效",
  login_required: "需要登录",
  two_factor_required: "需要两步验证",
  checkpoint_required: "需要安全验证",
};
export function FacebookAccountPanel() {
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof facebookAccountStatusAction>
  > | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<{
    id: string;
    origin: string;
    token: string;
    expiresAt: number;
  } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const form = useForm<Values>({
    resolver: zodResolver(facebookCredentialFormSchema),
    defaultValues: empty,
  });
  useEffect(() => {
    let disposed = false;
    let loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const result = await facebookAccountStatusAction();
        if (!disposed) setStatus(result);
      } catch {
        if (!disposed) setMessage("无法读取账号状态。请检查账号拥有者权限、环境配置和数据库迁移。");
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 10_000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!connection) return;
    const listener = (event: MessageEvent) => {
      if (event.origin !== connection.origin || event.source !== frame.current?.contentWindow)
        return;
      if (event.data?.type === "ftrade-ready")
        frame.current?.contentWindow?.postMessage(
          { type: "ftrade-connect", token: connection.token },
          connection.origin,
        );
      if (event.data?.type === "ftrade-disconnected") {
        setMessage("远程连接已结束。确认登录有效后，可恢复任务。");
        setConnection(null);
      }
    };
    window.addEventListener("message", listener);
    const expiry = setTimeout(
      () => {
        setConnection(null);
        setMessage("登录会话已过期，请重新连接。");
      },
      Math.max(1, connection.expiresAt - Date.now()),
    );
    return () => {
      window.removeEventListener("message", listener);
      clearTimeout(expiry);
    };
  }, [connection]);
  async function save(values: Values) {
    setBusy(true);
    try {
      const result = await saveFacebookCredentialsAction(values);
      setMessage(result.message);
      setStatus(await facebookAccountStatusAction());
    } catch {
      setMessage("保存未完成，请检查配置后重试。");
    } finally {
      form.reset(empty);
      setBusy(false);
    }
  }
  async function connect(useSavedLogin: boolean) {
    setBusy(true);
    try {
      const result = await openFacebookInteractiveAction({ useSavedLogin });
      if (result.ok) setConnection(result.connection);
      else setMessage(result.message);
    } catch {
      setMessage("无法创建登录连接。");
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    const id = connection?.id;
    setConnection(null);
    if (id)
      await closeFacebookInteractiveAction(id).catch(() =>
        setMessage("连接已从页面关闭；服务端将在心跳失效后撤销授权。"),
      );
  }
  const attention =
    status &&
    ["two_factor_required", "checkpoint_required", "login_required"].includes(status.authState);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Facebook 账号</CardTitle>
          <CardDescription>
            平台加密保存凭据。验证码直接输入远程 Facebook 页面，不提交给 Agent。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{labels[status?.authState ?? ""] ?? "读取状态中"}</Badge>
            <Badge variant="secondary">{status?.channelActive ? "任务运行中" : "任务已暂停"}</Badge>
            <Badge variant="outline">登录凭据：{status?.loginSaved ? "已保存" : "未保存"}</Badge>
            <Badge variant="outline">代理凭据：{status?.proxySaved ? "已保存" : "未保存"}</Badge>
          </div>
          {attention ? (
            <Alert>
              <AlertTitle>{labels[status.authState]}</AlertTitle>
              <AlertDescription>
                任务已暂停。点击“接入验证”，在下方浏览器完成验证；关闭连接并人工恢复后才继续执行。
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !!connection || !status?.loginSaved}
              onClick={() => void connect(true)}
            >
              使用已保存凭据登录
            </Button>
            <Button
              variant="outline"
              disabled={busy || !!connection}
              onClick={() => void connect(false)}
            >
              接入验证 / 手动登录
            </Button>
            <Button
              variant="outline"
              disabled={busy || !!connection || status?.authState !== "ready"}
              onClick={async () => {
                setBusy(true);
                try {
                  setMessage((await resumeFacebookAccountAction()).message);
                } catch {
                  setMessage("恢复未完成。");
                } finally {
                  setBusy(false);
                }
              }}
            >
              人工恢复任务
            </Button>
          </div>
          {connection ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm">独占连接，最长 10 分钟。请勿在远程浏览器切换账号。</p>
                <Button variant="outline" onClick={() => void close()}>
                  关闭连接
                </Button>
              </div>
              <iframe
                ref={frame}
                title="Facebook 安全登录与两步验证"
                src={`${connection.origin}/login`}
                sandbox="allow-scripts allow-same-origin"
                referrerPolicy="no-referrer"
                className="h-[560px] w-full rounded-md border"
              />
            </div>
          ) : null}
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {message}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>加密凭据</CardTitle>
          <CardDescription>
            留空保留原值。更新后暂停渠道；更新代理需要重启浏览器服务。不会回显已保存的密码。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(save)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["loginUsername", "Facebook 账号", "text"],
                  ["loginPassword", "Facebook 密码", "password"],
                  ["proxyHost", "固定代理主机", "text"],
                  ["proxyPort", "固定代理端口", "text"],
                  ["proxyUsername", "代理用户名", "text"],
                  ["proxyPassword", "代理密码", "password"],
                ] as const
              ).map(([name, label, type]) => (
                <Field key={name}>
                  <FieldLabel htmlFor={`fb-${name}`}>{label}</FieldLabel>
                  <Input
                    id={`fb-${name}`}
                    type={type}
                    autoComplete={type === "password" ? "new-password" : "off"}
                    disabled={busy || !!connection}
                    {...form.register(name)}
                  />
                  <FieldError errors={[form.formState.errors[name]]} />
                </Field>
              ))}
            </div>
            {(
              [
                ["clearLogin", "清除已保存的登录凭据"],
                ["clearProxy", "清除已保存的代理凭据"],
              ] as const
            ).map(([name, label]) => (
              <Field key={name} orientation="horizontal">
                <Controller
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <Checkbox
                      id={`fb-${name}`}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={busy || !!connection}
                    />
                  )}
                />
                <FieldLabel htmlFor={`fb-${name}`}>{label}</FieldLabel>
              </Field>
            ))}
            <Button type="submit" disabled={busy || !!connection}>
              保存加密凭据
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
