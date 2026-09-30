"use client";
import { FileSearchIcon, LinkIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { linkReadyProductToSalesProjectAction } from "@/lib/actions/workspace";
import type { ReadyProductContentSource } from "@/lib/content/store";
import type { WorkspaceProductReference } from "@/lib/workspace/types";

export function ProductReferencePanel({
  projectId,
  available,
  linked,
}: {
  projectId: string;
  available: ReadyProductContentSource[];
  linked: WorkspaceProductReference[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(
    available.find((item) => !linked.some((reference) => reference.id === item.id))?.id ?? "",
  );
  const [message, setMessage] = useState("");
  const [pending, startLink] = useTransition();
  const candidates = available.filter(
    (item) => !linked.some((reference) => reference.id === item.id),
  );
  const effectiveSelectedId = candidates.some((item) => item.id === selectedId)
    ? selectedId
    : (candidates[0]?.id ?? "");
  function link() {
    if (!effectiveSelectedId) return;
    startLink(async () => {
      const result = await linkReadyProductToSalesProjectAction(projectId, effectiveSelectedId);
      setMessage(result.message);
      if (result.status === "success") router.refresh();
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">产品引用</Badge>
          <Badge variant="outline">已核实产品</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          引用受控产品记录，不复制、不改写产品事实。
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>添加产品引用</CardTitle>
          <CardDescription>选择已核实产品，作为当前客户报价的产品依据。</CardDescription>
        </CardHeader>
        <CardContent>
          {candidates.length ? (
            <Field>
              <FieldLabel htmlFor="sales-product-reference">已核实产品</FieldLabel>
              <Select
                items={Object.fromEntries(
                  candidates.map((item) => [item.id, `${item.internalSku} · ${item.productName}`]),
                )}
                value={effectiveSelectedId}
                onValueChange={(value) => value && setSelectedId(value)}
              >
                <SelectTrigger id="sales-product-reference" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {candidates.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.internalSku} · {item.productName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">没有可添加的已核实产品。</p>
          )}
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button disabled={pending || !effectiveSelectedId} onClick={link}>
            <LinkIcon data-icon="inline-start" />
            引用到当前项目
          </Button>
          {message ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {message}
            </p>
          ) : null}
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>已引用产品</CardTitle>
        </CardHeader>
        <CardContent>
          {linked.length ? (
            <div className="flex flex-col gap-2">
              {linked.map((item) => (
                <Card key={item.id} size="sm">
                  <CardHeader>
                    <CardTitle>{item.internalSku}</CardTitle>
                    <CardDescription>{item.productName}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSearchIcon />
                </EmptyMedia>
                <EmptyTitle>尚未引用产品</EmptyTitle>
                <EmptyDescription>
                  RFQ 可先收集，但正式报价前必须由人工核对产品身份。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
