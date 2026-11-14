"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";

export function PageError({ retry, returnLink }: { retry: () => void; returnLink: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-64 items-center p-4">
      <Empty>
        <EmptyHeader>
          <h1
            ref={heading}
            tabIndex={-1}
            aria-describedby="page-error-description"
            className="text-lg font-semibold"
          >
            暂时无法显示此页面
          </h1>
          <EmptyDescription id="page-error-description">
            请重试加载，或返回工作台。未保存的内容可能已丢失；恢复后请先核对保存结果，避免重复提交。
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">
          <Button type="button" onClick={retry}>
            重试加载
          </Button>
          {returnLink}
        </EmptyContent>
      </Empty>
    </main>
  );
}
