"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function InvitationPanel() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function createInvitation() {
    setBusy(true);
    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as { error?: string };
      setMessage(result.error ?? "邀请已发送。链接在 7 天后过期。");
    } catch {
      setMessage("请求未完成，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1>邀请用户</h1>
        <p>仅管理员可发放单次、限时邀请。受邀人验证邮箱后账户才会激活。</p>
      </div>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="invite-email">受邀邮箱</FieldLabel>
          <Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Button disabled={busy || !email} onClick={createInvitation}>发送邀请</Button>
      </FieldGroup>
      <p aria-live="polite">{message}</p>
    </main>
  );
}
