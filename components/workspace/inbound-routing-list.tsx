"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderInputIcon, FolderPlusIcon, InboxIcon } from "lucide-react";

import { routeInboundConversationAction } from "@/lib/actions/closing";
import { initialClosingActionState } from "@/lib/action-states";
import type { InboundRoutingSummary } from "@/lib/social/inbound-routing-store";
import type { WorkspaceProjectSummary } from "@/lib/workspace/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

function RoutingDialog({ inbound, mode, salesProjects }: { inbound: InboundRoutingSummary; mode: "create" | "link"; salesProjects: WorkspaceProjectSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [state, action, pending] = useActionState(routeInboundConversationAction, initialClosingActionState);
  useEffect(() => {
    if (state.status === "success" && state.projectId) {
      setOpen(false);
      router.push(`/workspace/${state.projectId}?panel=lead&view=records&item=${state.id}`);
      router.refresh();
    }
  }, [router, state]);
  const creating = mode === "create";
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant={creating ? "default" : "outline"} className="min-h-11 flex-1" disabled={!creating && !salesProjects.length} />}>
      {creating ? <FolderPlusIcon data-icon="inline-start" /> : <FolderInputIcon data-icon="inline-start" />}{creating ? "新建销售项目" : "关联现有项目"}
    </DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>{creating ? "从入站消息新建销售项目" : "关联到现有销售项目"}</DialogTitle><DialogDescription>{creating ? `项目名将使用“入站线索 ${inbound.shortReference}”，不会暴露客户姓名或账号。` : "只显示你有权编辑的销售项目；原始消息仍留在受控会话存储中。"}</DialogDescription></DialogHeader>
      <form action={action} className="space-y-4">
        <input type="hidden" name="conversationId" value={inbound.id} /><input type="hidden" name="mode" value={mode} />
        {!creating ? <Field><FieldLabel htmlFor={`project-${inbound.id}`}>销售项目</FieldLabel><Select name="projectId" value={projectId} onValueChange={(value) => setProjectId(value ?? "")}><SelectTrigger id={`project-${inbound.id}`} className="min-h-11 w-full"><SelectValue>{salesProjects.find((project) => project.id === projectId)?.title ?? "选择项目"}</SelectValue></SelectTrigger><SelectContent>{salesProjects.map((project) => <SelectItem key={project.id} value={project.id}>{project.title}</SelectItem>)}</SelectContent></Select><FieldDescription>关联后，这条入站会话会成为该项目的线索入口。</FieldDescription></Field> : null}
        {state.message ? <p aria-live="polite" className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{state.message}</p> : null}
        <DialogFooter><Button type="submit" className="min-h-11" disabled={pending || (!creating && !projectId)}>{pending ? <Spinner data-icon="inline-start" /> : null}{creating ? `创建“入站线索 ${inbound.shortReference}”` : "关联所选项目"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function InboundRoutingList({ items, projects }: { items: InboundRoutingSummary[]; projects: WorkspaceProjectSummary[] }) {
  const salesProjects = projects.filter((project) => project.kind === "sales" && project.status === "active");
  if (!items.length) return null;
  return <div className="mb-4 space-y-3" aria-label="待分流入站消息">{items.map((item) => <div key={item.id} className="rounded-xl border bg-muted/30 p-4"><div className="flex items-start gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-background"><InboxIcon className="size-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">入站消息 {item.shortReference}</p><Badge>待分流</Badge></div><p className="mt-1 text-xs text-muted-foreground">{item.channelLabel} · {item.lastMessageAt.toLocaleString("zh-CN")}</p><p className="mt-2 text-sm text-muted-foreground">选择新建项目或关联现有项目后，才会进入销售流程。</p></div></div><div className="mt-4 flex flex-col gap-2 sm:flex-row"><RoutingDialog inbound={item} mode="create" salesProjects={salesProjects} /><RoutingDialog inbound={item} mode="link" salesProjects={salesProjects} /></div></div>)}</div>;
}
