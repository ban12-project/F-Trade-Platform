"use client";

import { PageError } from "@/components/page-error";
import { LinkButton } from "@/components/ui/button";

export default function RouteError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <PageError
      retry={retry}
      returnLink={
        <LinkButton href="/workspace" variant="outline">
          返回工作台
        </LinkButton>
      }
    />
  );
}
