"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { startTransition, useActionState, useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  publishingAccountsAction,
  saveSocialChannelControlAction,
} from "@/lib/actions/social-controls";
import { socialControlChangeSchema } from "@/lib/social/control-record";
import { type PublishingAccount, publishingBlockers } from "@/lib/social/publishing-account-policy";
import { WorkspaceLink } from "./workspace-link";

const schema = socialControlChangeSchema.omit({ actorId: true, actorType: true });
function AccountControls({
  account,
  refresh,
}: {
  account: PublishingAccount;
  refresh: () => void;
}) {
  const [state, action, pending] = useActionState(saveSocialChannelControlAction, {
    status: "idle",
    message: "",
  } as const);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      channelRef: account.channelRef,
      accountRef: account.accountRef,
      evidenceRef: "",
    },
  });
  useEffect(() => {
    if (state.status === "success") refresh();
  }, [state, refresh]);
  return (
    <form
      className="space-y-3"
      onSubmit={form.handleSubmit((values) => {
        const data = new FormData();
        for (const [key, value] of Object.entries(values)) data.set(key, value);
        startTransition(() => action(data));
      })}
    >
      <Field>
        <FieldLabel htmlFor={`operation-${account.id}`}>要执行的操作</FieldLabel>
        <NativeSelect
          id={`operation-${account.id}`}
          defaultValue=""
          {...form.register("action")}
          disabled={pending}
        >
          <NativeSelectOption value="" disabled>
            请选择操作（不会自动保存）
          </NativeSelectOption>
          <NativeSelectOption value="enable" disabled={account.publicationPaused}>
            允许发布
          </NativeSelectOption>
          <NativeSelectOption value="pause">暂停发布</NativeSelectOption>
          <NativeSelectOption value="resume">已处理异常，人工恢复发布</NativeSelectOption>
        </NativeSelect>
        <FieldError errors={[form.formState.errors.action]} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`reason-${account.id}`}>处理情况或操作原因</FieldLabel>
        <Input
          id={`reason-${account.id}`}
          {...form.register("evidenceRef")}
          placeholder="说明已核实的情况，操作将留存记录"
        />
        <FieldError errors={[form.formState.errors.evidenceRef]} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "正在保存…" : "确认操作"}
      </Button>
      {state.message && (
        <p role="status" className="text-sm">
          {state.message}
        </p>
      )}
    </form>
  );
}
export function PublishingAccountsPanel() {
  const [accounts, setAccounts] = useState<PublishingAccount[] | null>(null);
  const [error, setError] = useState("");
  const params = useSearchParams();
  const returnTo = params.get("returnTo");
  const refresh = useCallback(async () => {
    try {
      setAccounts(await publishingAccountsAction());
      setError("");
    } catch {
      setError("无法读取发布账号，请重试或检查管理权限。");
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  return (
    <section className="space-y-4" aria-label="发布账号">
      <h2 className="text-lg font-semibold">发布账号</h2>
      <p className="text-sm text-muted-foreground">
        保存凭据、验证登录和允许发布是独立步骤。每条内容仍需审核和人工确认；异常不会自动恢复。
      </p>
      {returnTo?.startsWith("/workspace/") && !returnTo.includes("\\") && (
        <WorkspaceLink href={returnTo} className="underline">
          返回所选内容，继续发布
        </WorkspaceLink>
      )}
      {error ? (
        <p role="alert">
          {error}
          <Button variant="outline" onClick={() => void refresh()}>
            重新读取
          </Button>
        </p>
      ) : accounts === null ? (
        <p role="status">正在读取账号状态…</p>
      ) : !accounts.length ? (
        <p>尚未添加发布账号。请在下方添加账号；没有可用服务时，先由管理员完成高级连接设置。</p>
      ) : null}
      {accounts?.map((account) => (
        <Card key={account.id}>
          <CardHeader>
            <CardTitle>
              {account.platform} · {account.name}
            </CardTitle>
            <CardDescription>
              账号授权：{account.authorizationEnabled ? "已启用" : "已停用"} · 凭据：
              {account.credentialsSaved ? "已保存" : "未保存"} · 登录：
              {account.loginState === "ready" ? "已验证" : "待处理"} · 发布：
              {account.publicationEnabled
                ? "已允许"
                : account.publicationPaused
                  ? "异常暂停"
                  : "未允许"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {account.ready ? (
              <p>可以选择已审核内容并提交发布。</p>
            ) : (
              <ol className="list-decimal pl-5 text-sm">
                {account.blockers.map((b) => (
                  <li key={b}>{publishingBlockers[b]}</li>
                ))}
              </ol>
            )}
            <a href={`#publishing-account-${account.id}`} className="text-sm underline">
              完成登录、管理授权或处理异常
            </a>
            {account.recoveryHref && (
              <WorkspaceLink className="block text-sm underline" href={account.recoveryHref}>
                查看上次发布结果并核实
              </WorkspaceLink>
            )}
            <AccountControls account={account} refresh={refresh} />
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
