"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InteractiveSessionTimer } from "@/components/workspace/interactive-session-timer";

const now = 1800000000000;
export function InteractiveSessionFixture() {
  const [deadline, setDeadline] = useState(now + 1800000);
  const [calls, setCalls] = useState(0);
  const [reject, setReject] = useState(false);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-6">
      <h1>合成接管时限验证（不连接真实账号）</h1>
      <Button onClick={() => setDeadline(now + 299000)}>模拟即将到期</Button>
      <Button onClick={() => setDeadline(now + 2000)}>模拟两秒后到期</Button>
      <Button
        onClick={() => {
          setReject(true);
          setDeadline(now + 298000);
        }}
      >
        模拟服务端拒绝
      </Button>
      <p>延长请求次数：{calls}</p>
      <InteractiveSessionTimer
        deadline={deadline}
        serverNow={now}
        onExtend={async (expected) => {
          setCalls((n) => n + 1);
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (reject) return false;
          setDeadline(expected + 1800000);
          return true;
        }}
      />
    </main>
  );
}
