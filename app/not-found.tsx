import type { Metadata } from "next";
import { PageUnavailable } from "@/components/page-unavailable";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: { absolute: "找不到页面 · F-Trade" } };

export default function NotFound() {
  return (
    <PageUnavailable
      title="找不到页面"
      description="这个地址没有对应页面。请检查链接，或返回工作台继续。"
      returnLink={
        <LinkButton href="/workspace" variant="outline">
          返回工作台
        </LinkButton>
      }
    />
  );
}
