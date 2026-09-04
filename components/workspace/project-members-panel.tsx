"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserMinusIcon, UserPlusIcon, UsersIcon } from "lucide-react";

import { removeWorkspaceProjectMemberAction, upsertWorkspaceProjectMemberAction, type WorkspaceActionState } from "@/lib/actions/workspace";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { WorkspaceMemberSummary } from "@/lib/workspace/access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";

const initialState: WorkspaceActionState = { status: "idle", message: "" };
const roleLabel = { owner: "所有者", editor: "可编辑", viewer: "仅查看" } as const;

export function ProjectMembersPanel({ projectId, members, currentUserId }: { projectId: string; members: WorkspaceMemberSummary[]; currentUserId: string }) {
  const router = useRouter();
  const canManage = members.some((member) => member.userId === currentUserId && member.role === "owner");
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"owner" | "editor" | "viewer">("editor");
  const [state, action, pending] = useActionState(upsertWorkspaceProjectMemberAction, initialState);
  const [removalState, removalAction, removalPending] = useActionState(removeWorkspaceProjectMemberAction, initialState);
  const [removalTarget, setRemovalTarget] = useState<WorkspaceMemberSummary | null>(null);
  useEffect(() => { if (state.status === "success" || removalState.status === "success") { setRemovalTarget(null); router.refresh(); } }, [removalState.status, router, state.status]);
  return <><Sheet open={open} onOpenChange={setOpen} modal={false}>
    <SheetTrigger render={<Button variant="outline" className="min-h-11" />}><UsersIcon data-icon="inline-start" />成员 {members.length}</SheetTrigger>
    <SheetContent side="right" showOverlay={false} className="top-20 bottom-24 h-auto rounded-l-2xl border-y bg-popover/95 backdrop-blur-xl sm:max-w-md">
      <SheetHeader><SheetTitle>项目成员</SheetTitle><SheetDescription>成员关系独立于项目创建者；角色决定查看、编辑与成员管理权限。</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        <div className="divide-y rounded-xl border">{members.map((member) => <div key={member.userId} className="flex min-h-16 items-center gap-3 px-3 py-2"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{member.name}</span><span className="block truncate text-xs text-muted-foreground">{member.email}</span></span><Badge variant={member.role === "owner" ? "default" : "secondary"}>{roleLabel[member.role]}</Badge>{canManage ? <Button type="button" size="icon" variant="ghost" aria-label={`移除成员 ${member.name}`} onClick={() => setRemovalTarget(member)}><UserMinusIcon /></Button> : null}</div>)}</div>
        {canManage ? <form action={action}><FieldGroup><Field><FieldLabel htmlFor="member-email">注册邮箱</FieldLabel><Input id="member-email" name="email" type="email" autoComplete="email" placeholder="member@example.com" required /><FieldDescription>仅可添加已注册账号；重复邮箱会更新其角色。</FieldDescription></Field><Field><FieldLabel htmlFor="member-role">项目角色</FieldLabel><Select name="role" value={role} onValueChange={(value) => value && setRole(value)}><SelectTrigger id="member-role" className="min-h-11 w-full"><SelectValue>{roleLabel[role]}</SelectValue></SelectTrigger><SelectContent><SelectItem value="owner">所有者</SelectItem><SelectItem value="editor">可编辑</SelectItem><SelectItem value="viewer">仅查看</SelectItem></SelectContent></Select></Field><input type="hidden" name="projectId" value={projectId} />{state.message ? <p aria-live="polite" className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{state.message}</p> : null}<Button className="min-h-11" type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" /> : <UserPlusIcon data-icon="inline-start" />}保存成员角色</Button></FieldGroup></form> : <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">只有项目所有者可以添加成员或调整角色。</p>}
      </div>
    </SheetContent>
  </Sheet><AlertDialog open={Boolean(removalTarget)} onOpenChange={(next) => { if (!next) setRemovalTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>移除项目成员？</AlertDialogTitle><AlertDialogDescription>移除后，“{removalTarget?.name}”将立即失去该项目的查看和编辑权限。操作会写入审计记录；最后一名所有者不能被移除。</AlertDialogDescription></AlertDialogHeader><form action={removalAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="userId" value={removalTarget?.userId ?? ""} />{removalState.status === "error" ? <p className="text-sm text-destructive" aria-live="polite">{removalState.message}</p> : null}<AlertDialogFooter><AlertDialogCancel>保留成员</AlertDialogCancel><Button type="submit" variant="destructive" disabled={removalPending}>{removalPending ? <Spinner data-icon="inline-start" /> : <UserMinusIcon data-icon="inline-start" />}移除 {removalTarget?.name}</Button></AlertDialogFooter></form></AlertDialogContent></AlertDialog></>;
}
