import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type SalesRelationRecord, salesRelations, salesStateLabels } from "@/lib/sales/journey";
import { workspaceCreateHref, workspaceRecordHref } from "@/lib/workspace/navigation";
import { WorkspaceLink } from "./workspace-link";

export function SalesContext({
  projectId,
  records,
  kind,
  id,
  canWrite,
  hideContinuation = false,
}: {
  projectId: string;
  records: SalesRelationRecord[];
  kind: SalesRelationRecord["kind"];
  id: string;
  canWrite: boolean;
  hideContinuation?: boolean;
}) {
  const context = salesRelations(records, kind, id);
  if (!context) return null;
  const { current, related } = context;
  const rfqs = related.filter((record) => record.kind === "rfq");
  const quotes = related.filter((record) => record.kind === "quotation");
  const leads = related.filter((record) => record.kind === "lead");
  let next: { href: string; label: string } | undefined;
  if (current.kind === "rfq" && current.state === "RFQ_READY") {
    if (quotes.length === 1)
      next = {
        href: workspaceRecordHref(projectId, "quotation", quotes[0].id),
        label: "打开人工报价",
      };
    else if (!quotes.length && canWrite && !context.missingContext)
      next = {
        href: workspaceCreateHref(projectId, "quotation", { kind: "rfq", id }),
        label: "创建人工报价",
      };
  } else if (current.kind === "lead" && current.state === "LEAD_RECEIVED") {
    if (rfqs.length === 1)
      next = { href: workspaceRecordHref(projectId, "rfq", rfqs[0].id), label: "继续整理客户需求" };
    else if (!rfqs.length && canWrite && !context.missingContext)
      next = {
        href: workspaceCreateHref(projectId, "rfq", { kind: "lead", id }),
        label: "整理客户需求",
      };
  } else if (current.kind === "quotation" && current.state === "QUOTE_SENT") {
    const sentLeads = leads.filter((lead) => lead.quotationId === id);
    if (sentLeads.length === 1)
      next = {
        href: workspaceRecordHref(projectId, "lead", sentLeads[0].id),
        label: "继续客户跟进",
      };
  } else if (current.kind === "delivery") {
    const requestLeads = leads.filter((lead) => lead.deliveryId === id);
    if (requestLeads.length === 1)
      next = {
        href: workspaceRecordHref(projectId, "lead", requestLeads[0].id),
        label: "返回客户跟进",
      };
  }
  return (
    <Card role="region" aria-label="当前客户上下文">
      <CardHeader>
        <CardTitle>{current.title}</CardTitle>
        <CardDescription>
          {salesStateLabels[current.state] ?? "查看当前记录"}。
          {context.missingContext
            ? "部分关联记录不可访问或关系不一致，请核对后继续。"
            : related.length
              ? "需求、报价和会话均来自已关联的记录。"
              : "从当前记录继续，后续关联会保留在这里。"}
        </CardDescription>
      </CardHeader>
      {related.length ? (
        <CardContent>
          <nav aria-label="客户相关记录" className="flex flex-col gap-2">
            {related.map((record) => (
              <WorkspaceLink
                key={`${record.kind}:${record.id}`}
                href={workspaceRecordHref(projectId, record.kind, record.id)}
                className="rounded-md border p-3 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block break-words font-medium">{record.title}</span>
                <span className="text-xs text-muted-foreground">
                  {salesStateLabels[record.state] ?? "查看记录"}
                </span>
              </WorkspaceLink>
            ))}
          </nav>
        </CardContent>
      ) : null}
      {next && !hideContinuation ? (
        <CardFooter>
          <WorkspaceLink href={next.href} className={buttonVariants({})}>
            {next.label}
          </WorkspaceLink>
        </CardFooter>
      ) : null}
    </Card>
  );
}
