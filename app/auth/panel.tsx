"use client";

import { useEffect, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon, MailCheckIcon, ShieldCheckIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { provisionInvitedUserAction } from "@/lib/actions/invitations";
import { authClient } from "@/lib/auth-client";
import { authFormSchema } from "@/lib/form-schemas";

export function AuthPanel() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitationProvisioned, setInvitationProvisioned] = useState(false);
  const [provisioning, startProvisioning] = useTransition();
  const form = useForm<z.infer<typeof authFormSchema>>({
    resolver: zodResolver(authFormSchema),
    defaultValues: { email: "", otp: "" },
  });

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    setInviteToken(searchParams.get("invite"));
    if (searchParams.get("error") === "access-denied") {
      setMessage("登录成功，但当前账号没有工作台访问权限。请联系管理员为该账号授予管理员权限。");
    }
  }, []);

  function enterWorkspace() {
    // Authentication changes the cookie set used by the proxy. A document
    // navigation guarantees the next request evaluates that fresh session.
    window.location.assign("/workspace");
  }

  async function run(action: () => Promise<{ error?: { message?: string } | null }>, success: string) {
    setBusy(true);
    try {
      const { error } = await action();
      if (error) {
        setMessage(error.message ?? "请求未完成，请检查认证信息后重试。");
        return false;
      }
      setMessage(success);
      return true;
    } catch {
      setMessage("请求未完成，请检查网络和认证配置后重试。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp() {
    const emailIsValid = await form.trigger("email");
    if (!emailIsValid) return;
    const email = form.getValues("email");
    if (inviteToken && !invitationProvisioned) {
      startProvisioning(async () => {
        const result = await provisionInvitedUserAction({ email, token: inviteToken });
        setMessage(result.message);
        if (result.status !== "success") return;
        setInvitationProvisioned(true);
        window.history.replaceState({}, "", "/auth");
        await run(
          () => authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" }),
          "验证码已发送。验证后即可激活账户。",
        );
      });
      return;
    }
    await run(
      () => authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" }),
      "验证码已发送。验证后即可激活账户。",
    );
  }

  async function verifyOtp(values: z.infer<typeof authFormSchema>) {
    const signedIn = await run(
      () => authClient.signIn.emailOtp({
        email: values.email,
        otp: values.otp,
        name: values.email.split("@")[0] || "F-Trade User",
      }),
      "登录成功。你现在可以注册 Passkey。",
    );
    if (signedIn) enterWorkspace();
  }

  async function signInPasskey() {
    const signedIn = await run(() => authClient.signIn.passkey(), "Passkey 登录成功。");
    if (signedIn) enterWorkspace();
  }

  async function addPasskey() {
    await run(() => authClient.passkey.addPasskey({ name: "F-Trade Passkey" }), "Passkey 已注册。");
  }

  return (
    <main id="main-content" className="flex min-h-svh items-center justify-center bg-muted/30 p-4 md:p-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border bg-background shadow-sm md:grid-cols-[0.9fr_1.1fr]">
        <section className="hidden flex-col justify-between bg-primary p-8 text-primary-foreground md:flex lg:p-10">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary-foreground/15 text-lg font-semibold" aria-hidden="true">F</span>
            <span className="font-semibold tracking-tight">F-Trade</span>
          </div>
          <div className="flex flex-col gap-5">
            <Badge variant="outline" className="w-fit border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground">内部工作台</Badge>
            <div className="flex flex-col gap-3">
              <p className="text-3xl font-semibold tracking-tight text-balance">让证据成为工作流的起点。</p>
              <p className="text-sm leading-6 text-primary-foreground/70">产品事实需要来源，内容需要审核，报价与交期需要人工确认。</p>
            </div>
          </div>
          <p className="text-xs text-primary-foreground/55">离合器外贸工作流 · MVP</p>
        </section>

        <section className="flex flex-col gap-7 p-6 sm:p-8 lg:p-10">
          <header className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground md:hidden">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs text-primary-foreground" aria-hidden="true">F</span>
              F-Trade
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">受邀访问</Badge>
              <ShieldCheckIcon aria-hidden="true" className="text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">登录工作台</h1>
              <p className="text-sm leading-6 text-muted-foreground">使用受邀邮箱验证码或设备密钥（Passkey）登录。平台不启用密码登录，也不开放公开注册。</p>
            </div>
          </header>

          <form onSubmit={form.handleSubmit(verifyOtp)}>
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.email}>
                <FieldLabel htmlFor="email">邮箱</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  placeholder="name@example.com"
                  aria-invalid={!!form.formState.errors.email}
                  {...form.register("email")}
                />
                <FieldError errors={[form.formState.errors.email]} />
              </Field>
              <Button type="button" variant="outline" disabled={busy || provisioning} onClick={sendOtp}>
                {busy || provisioning ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <MailCheckIcon data-icon="inline-start" />}
                发送验证码
              </Button>
              <Field data-invalid={!!form.formState.errors.otp}>
                <FieldLabel htmlFor="otp">邮箱验证码</FieldLabel>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="输入 6 位验证码…"
                  aria-invalid={!!form.formState.errors.otp}
                  {...form.register("otp")}
                />
                <FieldError errors={[form.formState.errors.otp]} />
              </Field>
              <Button type="submit" disabled={busy || provisioning}>
                {busy || provisioning ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
                验证并登录
              </Button>
            </FieldGroup>
          </form>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            或使用设备凭据
            <Separator className="flex-1" />
          </div>
          <div className="flex flex-col gap-2">
            <Button type="button" variant="outline" disabled={busy || provisioning} onClick={signInPasskey}>
              {busy || provisioning ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
              使用 Passkey 登录
            </Button>
            <Button type="button" variant="ghost" disabled={busy || provisioning} onClick={addPasskey}>
              注册当前设备 Passkey
            </Button>
          </div>
          <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">{message}</p>
        </section>
      </div>
    </main>
  );
}
