"use client";

import { useState } from "react";
import { KeyRoundIcon, ShieldCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

export function PasskeyPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function addPasskey() {
    setBusy(true);
    try {
      const { error } = await authClient.passkey.addPasskey({ name: "F-Trade Passkey" });
      setMessage(error?.message ?? "Passkey 已添加。下次可使用此设备安全登录。");
    } catch {
      setMessage("无法添加 Passkey。请确认设备支持并允许使用设备凭据后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-h-full flex-col gap-6 p-4 md:p-6 lg:p-8" aria-labelledby="passkey-heading">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <ShieldCheckIcon aria-hidden="true" />
          账号安全
        </div>
        <h1 id="passkey-heading" className="text-3xl font-semibold tracking-tight">安全与 Passkey</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">在当前设备上添加 Passkey，以便下次使用指纹、面容或设备解锁方式登录。</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>添加当前设备</CardTitle>
          <CardDescription>Passkey 不会暴露密码，并由当前设备或密码管理器安全保存。</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">{message}</p>
        </CardContent>
        <CardFooter>
          <Button type="button" disabled={busy} onClick={addPasskey}>
            {busy ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
            添加当前设备的 Passkey
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}
