"use client";

import { cjk } from "@streamdown/cjk";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

const markdownPlugins = { cjk };

export function MarkdownContent({
  children,
  isAnimating = false,
  controls,
  className,
}: {
  children: string;
  isAnimating?: boolean;
  controls?: React.ComponentProps<typeof Streamdown>["controls"];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-x-auto text-sm leading-6 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1.5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_ul]:list-disc",
        className,
      )}
    >
      <Streamdown plugins={markdownPlugins} controls={controls} isAnimating={isAnimating}>
        {children}
      </Streamdown>
    </div>
  );
}
