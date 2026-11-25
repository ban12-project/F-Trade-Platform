"use client";

// This boundary replaces the root layout, including its stylesheet imports.
import "./globals.css";
import { PageError } from "@/components/page-error";
import { buttonVariants } from "@/components/ui/button";

export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="zh-CN">
      <head>
        <title>工作台暂时无法打开 · F-Trade</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif" }}>
        <PageError
          title="工作台暂时无法打开"
          retry={retry}
          returnLink={
            <a href="/workspace" className={buttonVariants({ variant: "outline" })}>
              返回工作台
            </a>
          }
        />
      </body>
    </html>
  );
}
