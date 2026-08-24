"use client";

import { useState } from "react";

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
      setResult(await response.json() as MockChannelResult);
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <h1>Mock official channel 验收</h1>
      <p>仅测试构建可用：只处理 synthetic webhook 元数据，不发送真实 API 请求。</p>
      <div>
        <button type="button" onClick={() => void invoke("reset")} disabled={pending}>重置 mock 场景</button>
        <button type="button" onClick={() => void invoke("deliver")} disabled={pending}>投递 synthetic webhook</button>
        <button type="button" onClick={() => void invoke("duplicate")} disabled={pending}>重发相同 webhook</button>
        <button type="button" onClick={() => void invoke("fail")} disabled={pending}>模拟下游失败</button>
        <button type="button" onClick={() => void invoke("retry")} disabled={pending}>重试失败 webhook</button>
      </div>
      <output aria-live="polite">
        {result ? `状态：${result.status}；下一步：${result.nextAction}；已接受动作：${result.acceptedActionCount}${result.reason ? `；原因：${result.reason}` : ""}` : "尚未执行 mock webhook"}
      </output>
    </main>
  );
}
