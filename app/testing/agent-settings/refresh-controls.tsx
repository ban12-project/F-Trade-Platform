"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function RefreshControls({ revision }: { revision: string }) {
  const router = useRouter();
  return (
    <div>
      <Button variant="outline" onClick={() => router.refresh()}>
        刷新合成配置
      </Button>
      <output aria-label="合成配置版本">{revision}</output>
    </div>
  );
}
