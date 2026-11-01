"use client";

import { CircleHelpIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function WorkspaceGuide() {
  const pathname = usePathname();
  return <WorkspaceGuideButton key={pathname} pathname={pathname} />;
}

function WorkspaceGuideButton({ pathname }: { pathname: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const current = useRef<{ destroy: () => void } | null>(null);
  const generation = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Also invalidate an import that finishes after navigation or unmounting.
    generation.current += 1;
    return () => {
      generation.current += 1;
      current.current?.destroy();
      current.current = null;
    };
  }, []);

  async function start() {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const { startWorkspaceGuide } = await import("./workspace-guide-tour");
      if (request !== generation.current) return;
      current.current?.destroy();
      current.current = startWorkspaceGuide(pathname, () => {
        // Driver restores its own previous step's focus after onDestroyed.
        queueMicrotask(() => {
          if (request === generation.current) button.current?.focus();
        });
      });
    } catch {
      if (request === generation.current) setError("引导暂时未能加载，请再试一次。");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        ref={button}
        type="button"
        variant="ghost"
        size="sm"
        onClick={start}
        disabled={loading}
      >
        {loading ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <CircleHelpIcon data-icon="inline-start" />
        )}
        使用引导
      </Button>
    </div>
  );
}
