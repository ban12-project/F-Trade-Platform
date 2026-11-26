"use client";

import { EyeIcon, Maximize2Icon, Minimize2Icon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const MarkdownContent = dynamic(
  () => import("./markdown-content").then((module) => module.MarkdownContent),
  { ssr: false },
);

export function MarkdownPreviewDialog({
  open,
  onOpenChange,
  triggerLabel,
  title,
  description,
  markdown,
  isAnimating = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerLabel: string;
  title: string;
  description: string;
  markdown: string;
  isAnimating?: boolean;
}) {
  const [fullscreen, setFullscreen] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) setFullscreen(false);
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <EyeIcon data-icon="inline-start" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent
        data-fullscreen={fullscreen ? "true" : "false"}
        className={cn(
          "flex flex-col",
          fullscreen
            ? "h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-2rem)]"
            : "max-h-[85dvh] sm:max-w-3xl",
        )}
      >
        <DialogHeader className="flex-row flex-wrap items-start justify-between gap-2 pr-10">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={fullscreen}
            onClick={() => setFullscreen((current) => !current)}
          >
            {fullscreen ? (
              <Minimize2Icon data-icon="inline-start" />
            ) : (
              <Maximize2Icon data-icon="inline-start" />
            )}
            {fullscreen ? "退出全屏" : "全屏查看"}
          </Button>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-background p-4">
          {open ? (
            <MarkdownContent
              isAnimating={isAnimating}
              // Keep fullscreen inside this top-layer dialog so document.body portals aren't occluded.
              controls={{ table: { fullscreen: false }, mermaid: { fullscreen: false } }}
            >
              {markdown}
            </MarkdownContent>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
