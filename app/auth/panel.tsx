"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import { authClient } from "../../lib/auth-client";

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
    await run(
      () => authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" }),
      "验证码已发送。首次验证会创建账号。",
    );
  }

  async function verifyOtp() {
    await run(
      () => authClient.signIn.emailOtp({ email, otp, name: email.split("@")[0] || "F-Trade User" }),
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
      <h1>登录或注册</h1>
      <p>使用邮箱验证码或 Passkey，不使用密码。</p>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">邮箱</FieldLabel>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Button disabled={busy || !email} onClick={sendOtp}>发送验证码</Button>
        <Field>
          <FieldLabel htmlFor="otp">验证码</FieldLabel>
          <Input
            id="otp"
            inputMode="numeric"
            value={otp}
            onChange={(event) => setOtp(event.target.value)}
          />
        </Field>
        <Button disabled={busy || !email || !otp} onClick={verifyOtp}>
          验证并登录/注册
        </Button>
      </FieldGroup>
      <Separator />
      <div className="flex flex-col gap-2">
        <Button variant="outline" disabled={busy} onClick={signInPasskey}>
          使用 Passkey 登录
        </Button>
        <Button variant="outline" disabled={busy} onClick={addPasskey}>
          注册当前设备 Passkey
        </Button>
      </div>
      <p aria-live="polite">{message}</p>
    </main>
  );
}
