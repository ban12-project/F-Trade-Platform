import { LinkButton } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export default function ProjectNotFound() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle role="heading" aria-level={1}>
          无法打开此项目
        </EmptyTitle>
        <EmptyDescription>该项目不可用，或你没有查看权限。</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <LinkButton href="/workspace" variant="outline">
          返回工作台
        </LinkButton>
      </EmptyContent>
    </Empty>
  );
}
