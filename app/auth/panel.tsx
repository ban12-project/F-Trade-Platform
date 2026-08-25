"use client";

import { useEffect, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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
    setInviteToken(new URLSearchParams(window.location.search).get("invite"));
  }, []);

  async function run(action: () => Promise<{ error?: { message?: string } | null }>, success: string) {
    setBusy(true);
    try {
      const { error } = await action();
      setMessage(error?.message ?? success);
    } catch {
      setMessage("请求未完成，请检查网络和认证配置后重试。");
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
    await run(
      () => authClient.signIn.emailOtp({
        email: values.email,
        otp: values.otp,
        name: values.email.split("@")[0] || "F-Trade User",
      }),
      "登录成功。你现在可以注册 Passkey。",
    );
  }

  async function signInPasskey() {
    await run(() => authClient.signIn.passkey(), "Passkey 登录成功。");
  }

  async function addPasskey() {
    await run(() => authClient.passkey.addPasskey({ name: "F-Trade Passkey" }), "Passkey 已注册。");
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 p-6">
      <h1>登录</h1>
      <p>仅受邀用户可使用邮箱验证码或 Passkey 登录，不使用密码。</p>
      <form onSubmit={form.handleSubmit(verifyOtp)}>
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.email}>
            <FieldLabel htmlFor="email">邮箱</FieldLabel>
            <Input
              id="email"
              type="email"
              aria-invalid={!!form.formState.errors.email}
              {...form.register("email")}
            />
            <FieldError errors={[form.formState.errors.email]} />
          </Field>
          <Button type="button" disabled={busy || provisioning} onClick={sendOtp}>发送验证码</Button>
          <Field data-invalid={!!form.formState.errors.otp}>
            <FieldLabel htmlFor="otp">验证码</FieldLabel>
            <Input
              id="otp"
              inputMode="numeric"
              aria-invalid={!!form.formState.errors.otp}
              {...form.register("otp")}
            />
            <FieldError errors={[form.formState.errors.otp]} />
          </Field>
          <Button type="submit" disabled={busy || provisioning}>
            验证并登录
          </Button>
        </FieldGroup>
      </form>
      <Separator />
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" disabled={busy || provisioning} onClick={signInPasskey}>
          使用 Passkey 登录
        </Button>
        <Button type="button" variant="outline" disabled={busy || provisioning} onClick={addPasskey}>
          注册当前设备 Passkey
        </Button>
      </div>
      <p aria-live="polite">{message}</p>
    </main>
  );
}
