"use client";

import { CopyIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { initialContentActionState } from "@/lib/action-states";
import { copyContentDraftToProjectAction } from "@/lib/actions/content";
import type { ContentCopyCandidate } from "@/lib/content/store";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { useCreatedRecord } from "./use-created-record";
import { WorkspaceLink as Link } from "./workspace-link";

const _contentTypes = [
  ["product", "产品推广"],
  ["factory_capability", "工厂能力"],
  ["industry_knowledge", "行业知识"],
] as const;
export function ContentCopy({
  projectId,
  candidates,
}: {
  projectId: string;
  candidates: ContentCopyCandidate[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(candidates[0]?.id ?? "");
  const [state, action, pending] = useActionState(
    copyContentDraftToProjectAction,
    initialContentActionState,
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
  useCreatedRecord(projectId, "content", state.status, state.contentId);
  function copy() {
    if (!selected) return;
    const data = new FormData();
    data.set("projectId", projectId);
    data.set("sourceContentId", selected);
    startTransition(() => action(data));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>从其他项目复制</CardTitle>
        <CardDescription>创建独立待审草稿；后续修订和审核不会影响源项目。</CardDescription>
      </CardHeader>
      <CardContent>
        {candidates.length ? (
          <Field>
            <FieldLabel>源内容</FieldLabel>
            <Select
              items={Object.fromEntries(
                candidates.map((item) => [
                  item.id,
                  `${item.projectTitle} · ${item.productName} · ${item.hook}`,
                ]),
              )}
              value={selected}
              onValueChange={(value) => value && setSelected(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {candidates.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.projectTitle} · {item.productName} · {item.hook}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <p className="text-sm text-muted-foreground">其他项目暂无可复制内容。</p>
        )}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button disabled={pending || !selected} onClick={copy}>
          <CopyIcon data-icon="inline-start" />
          复制为新草稿
        </Button>
        {state.status === "success" && state.contentId ? (
          <Button
            render={<Link href={workspaceRecordHref(projectId, "content", state.contentId)} />}
            variant="outline"
          >
            打开复制的内容草稿
          </Button>
        ) : null}
        {state.message ? (
          <p
            className={
              state.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {state.message}
          </p>
        ) : null}
      </CardFooter>
    </Card>
  );
}
