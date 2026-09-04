import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { getDatabase, type DatabaseExecutor } from "@/lib/db/client";
import { evidence, user, workspaceProject, workspaceProjectEvidence, workspaceProjectMember } from "@/lib/db/schema";

export type WorkspaceMemberRole = "owner" | "editor" | "viewer";
export type WorkspaceAccess = "view" | "write" | "manage";
export type WorkspaceMemberSummary = { userId: string; name: string; email: string; role: WorkspaceMemberRole };
export type EvidenceOption = { id: string; sourceLabel: string; contentType: string; classification: "internal" | "confidential" | "restricted"; createdAt: Date };

export const workspaceMemberFormSchema = z.object({
  projectId: z.uuid("项目标识无效。"),
  email: z.string().trim().email("请输入有效邮箱地址。"),
  role: z.enum(["owner", "editor", "viewer"]),
});

export async function assertWorkspaceProjectAccess(
  projectId: string,
  actorId: string,
  access: WorkspaceAccess,
  database: DatabaseExecutor = getDatabase(),
) {
  const allowedRoles: WorkspaceMemberRole[] = access === "manage" ? ["owner"] : access === "write" ? ["owner", "editor"] : ["owner", "editor", "viewer"];
  const [membership] = await database.select({ role: workspaceProjectMember.role })
    .from(workspaceProjectMember)
    .where(and(eq(workspaceProjectMember.projectId, projectId), eq(workspaceProjectMember.userId, actorId), inArray(workspaceProjectMember.role, allowedRoles)));
  if (!membership) throw new Error(access === "view" ? "你不是该项目成员。" : access === "write" ? "你没有该项目的编辑权限。" : "只有项目所有者可以管理成员。");
  return membership;
}

export async function listWorkspaceProjectMembers(projectId: string, actorId: string, database: DatabaseExecutor = getDatabase()): Promise<WorkspaceMemberSummary[]> {
  await assertWorkspaceProjectAccess(projectId, actorId, "view", database);
  return database.select({ userId: user.id, name: user.name, email: user.email, role: workspaceProjectMember.role })
    .from(workspaceProjectMember)
    .innerJoin(user, eq(user.id, workspaceProjectMember.userId))
    .where(eq(workspaceProjectMember.projectId, projectId))
    .orderBy(asc(user.name));
}

export async function upsertWorkspaceProjectMember(input: unknown, actorId: string, database: DatabaseExecutor = getDatabase()) {
  const value = workspaceMemberFormSchema.parse(input);
  await database.transaction(async (tx) => {
    await assertWorkspaceProjectAccess(value.projectId, actorId, "manage", tx);
    const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.email, value.email));
    if (!target) throw new Error("该邮箱尚未注册，不能加入项目。");
    const [currentTarget] = await tx.select({ role: workspaceProjectMember.role }).from(workspaceProjectMember).where(and(eq(workspaceProjectMember.projectId, value.projectId), eq(workspaceProjectMember.userId, target.id)));
    if (currentTarget?.role === "owner" && value.role !== "owner") {
      const owners = await tx.select({ id: workspaceProjectMember.id }).from(workspaceProjectMember).where(and(eq(workspaceProjectMember.projectId, value.projectId), eq(workspaceProjectMember.role, "owner")));
      if (owners.length === 1) throw new Error("项目必须至少保留一名所有者。请先添加另一名所有者。");
    }
    await tx.insert(workspaceProjectMember).values({ id: randomUUID(), projectId: value.projectId, userId: target.id, role: value.role, createdById: actorId })
      .onConflictDoUpdate({ target: [workspaceProjectMember.projectId, workspaceProjectMember.userId], set: { role: value.role } });
  });
}

export async function listProjectEvidenceOptions(projectId: string, actorId: string, database: DatabaseExecutor = getDatabase()): Promise<EvidenceOption[]> {
  await assertWorkspaceProjectAccess(projectId, actorId, "view", database);
  return database.selectDistinct({ id: evidence.id, sourceLabel: evidence.sourceLabel, contentType: evidence.contentType, classification: evidence.classification, createdAt: evidence.createdAt })
    .from(evidence)
    .leftJoin(workspaceProjectEvidence, and(eq(workspaceProjectEvidence.evidenceId, evidence.id), eq(workspaceProjectEvidence.projectId, projectId)))
    .where(or(eq(workspaceProjectEvidence.projectId, projectId), and(eq(evidence.uploadedByType, "human"), eq(evidence.uploadedById, actorId))))
    .orderBy(asc(evidence.sourceLabel));
}

export async function assertAndLinkProjectEvidence(
  projectId: string,
  evidenceIds: string[],
  actorId: string,
  database: DatabaseExecutor = getDatabase(),
) {
  const uniqueIds = [...new Set(evidenceIds.filter(Boolean))];
  if (!uniqueIds.length) throw new Error("至少需要一项已持久化证据。");
  await assertWorkspaceProjectAccess(projectId, actorId, "write", database);
  const rows = await database.select({ id: evidence.id, linkedProjectId: workspaceProjectEvidence.projectId, uploadedByType: evidence.uploadedByType, uploadedById: evidence.uploadedById })
    .from(evidence)
    .leftJoin(workspaceProjectEvidence, and(eq(workspaceProjectEvidence.evidenceId, evidence.id), eq(workspaceProjectEvidence.projectId, projectId)))
    .where(inArray(evidence.id, uniqueIds));
  const allowed = new Set(rows.filter((row) => row.linkedProjectId === projectId || (row.uploadedByType === "human" && row.uploadedById === actorId)).map((row) => row.id));
  const missing = uniqueIds.filter((id) => !allowed.has(id));
  if (missing.length) throw new Error("部分证据不存在或无权用于当前项目。");
  await database.insert(workspaceProjectEvidence).values(uniqueIds.map((evidenceId) => ({ id: randomUUID(), projectId, evidenceId, linkedById: actorId }))).onConflictDoNothing();
}

export async function projectExistsForMember(projectId: string, actorId: string, database: DatabaseExecutor = getDatabase()) {
  const [row] = await database.select({ id: workspaceProject.id }).from(workspaceProject)
    .innerJoin(workspaceProjectMember, eq(workspaceProjectMember.projectId, workspaceProject.id))
    .where(and(eq(workspaceProject.id, projectId), eq(workspaceProjectMember.userId, actorId)));
  return Boolean(row);
}
