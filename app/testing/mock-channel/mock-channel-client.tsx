"use client";

import { ArrowLeftIcon, FlaskConicalIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

type MockChannelResult = {
  status: "accepted" | "duplicate" | "rejected";
  nextAction: "create_or_update_lead" | "ignore_duplicate" | "none";
  acceptedActionCount: number;
  reason?: "synthetic_downstream_failure";
};

export function MockChannelClient() {
  const [result, setResult] = useState<MockChannelResult | null>(null);
  const [pending, setPending] = useState(false);

  async function invoke(action: "reset" | "deliver" | "duplicate" | "fail" | "retry") {
    setPending(true);
    try {
      const response = await fetch("/api/testing/mock-channel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setResult((await response.json()) as MockChannelResult);
    } finally {
      setPending(false);
    }
  }

  return (
    <main
      id="main-content"
      className="flex min-h-svh items-center justify-center bg-muted/30 p-4 md:p-8"
    >
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">合成验收</Badge>
            <FlaskConicalIcon aria-hidden="true" className="text-muted-foreground" />
          </div>
          <CardTitle>
            <h1>Mock official channel 验收</h1>
          </CardTitle>
          <CardDescription>
            仅测试构建可用：只处理 synthetic webhook 元数据，不发送真实 API 请求。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void invoke("reset")}
              disabled={pending}
            >
              {pending && <Spinner aria-hidden="true" data-icon="inline-start" />}
              重置 mock 场景
            </Button>
            <Button type="button" onClick={() => void invoke("deliver")} disabled={pending}>
              {pending && <Spinner aria-hidden="true" data-icon="inline-start" />}
              投递 synthetic webhook
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void invoke("duplicate")}
              disabled={pending}
            >
              重发相同 webhook
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void invoke("fail")}
              disabled={pending}
            >
              模拟下游失败
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void invoke("retry")}
              disabled={pending}
            >
              重试失败 webhook
            </Button>
          </div>
          <output
            className="rounded-lg border bg-muted/30 p-4 text-sm leading-6"
            aria-live="polite"
          >
            {result
              ? `状态：${result.status}；下一步：${result.nextAction}；已接受动作：${result.acceptedActionCount}${result.reason ? `；原因：${result.reason}` : ""}`
              : "尚未执行 mock webhook"}
          </output>
          <LinkButton className="w-fit" size="sm" variant="ghost" href="/testing">
            <ArrowLeftIcon data-icon="inline-start" />
            返回测试基线
          </LinkButton>
        </CardContent>
      </Card>
    </main>
  );
}
