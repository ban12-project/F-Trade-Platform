"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export function FailureTrigger() {
  const [failed, setFailed] = useState(false);
  if (failed) throw new Error("SYNTHETIC_PRIVATE_CLIENT_DETAIL");
  return <Button onClick={() => setFailed(true)}>触发合成客户端异常</Button>;
}
