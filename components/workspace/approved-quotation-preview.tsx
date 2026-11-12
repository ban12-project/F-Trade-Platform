"use client";

import { CopyIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import { buildApprovedQuotationPreview } from "@/lib/quotation/customer-preview";
import type { QuotationEntry } from "@/lib/sales/closing-store";
import type { RfqEntry } from "@/lib/sales/store";
import type { WorkspaceProductReference } from "@/lib/workspace/types";

export function ApprovedQuotationPreview({
  entry,
  rfqs,
  products,
}: {
  entry: QuotationEntry;
  rfqs: RfqEntry[];
  products: WorkspaceProductReference[];
}) {
  const preview = buildApprovedQuotationPreview(entry, rfqs, products);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [copyResult, setCopyResult] = useState<{
    text: string;
    status: "copying" | "copied" | "failed";
  } | null>(null);
  const copyStatus = copyResult?.text === preview?.text ? copyResult?.status : "idle";

  async function copyText() {
    if (!preview || copyStatus === "copying") return;
    setCopyResult({ text: preview.text, status: "copying" });
    try {
      await navigator.clipboard.writeText(preview.text);
      setCopyResult({ text: preview.text, status: "copied" });
    } catch {
      setCopyResult({ text: preview.text, status: "failed" });
      textRef.current?.focus();
      textRef.current?.select();
    }
  }

  if (!preview)
    return (
      <Alert variant="destructive">
        <AlertTitle>暂不能生成已批准报价文案</AlertTitle>
        <AlertDescription>
          当前报价版本与审批记录不一致，请刷新或联系审核者核对。不会使用待审或退回条款生成交付文案。
        </AlertDescription>
      </Alert>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>已批准报价只读预览 · 版本 {preview.version}</CardTitle>
        <CardDescription>
          商业条款来自当前已批准报价。客户、产品和需求数量来自关联记录，不代表审批时的快照，请发送前核对。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTitle>核对有效期后，由你手动发送</AlertTitle>
          <AlertDescription>
            报价只记录有效天数，未记录起算日期或到期日；文案不会推算这些日期，也不会补写数量单位或订单总额。复制不会发送消息或登记已发送。
          </AlertDescription>
        </Alert>
        <Field>
          <FieldLabel htmlFor={`quotation-preview-${entry.id}`}>
            客户报价文案（英文，只读）
          </FieldLabel>
          <Textarea
            ref={textRef}
            id={`quotation-preview-${entry.id}`}
            readOnly
            value={preview.text}
            rows={22}
            className="font-mono text-sm"
          />
        </Field>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={copyText}
          disabled={copyStatus === "copying"}
        >
          <CopyIcon data-icon="inline-start" />
          {copyStatus === "copying" ? "正在复制" : "复制客户报价文案"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {copyStatus === "copied"
            ? "已复制。尚未发送；请人工核对并发送后，在下方登记渠道和发送凭证。"
            : copyStatus === "failed"
              ? "无法访问剪贴板，已选中文案，请手动复制。尚未发送或登记发送结果。"
              : "可直接选中文案复制。请保留版本信息，并核对收件人及全部待确认项。"}
        </p>
      </CardFooter>
    </Card>
  );
}
