"use server";

import { headers } from "next/headers";
import { start } from "workflow/api";
import { z } from "zod";
import { resolveProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import {
  type CatalogActionResult,
  type CatalogImportView,
  catalogIntakeSchema,
  catalogLookupSchema,
  catalogSelectionSchema,
} from "@/lib/product/catalog-import-contracts";
import {
  attachCatalogWorkflow,
  type CatalogDispatch,
  type CatalogIdentity,
  catalogImportView,
  failCatalogAttempt,
  intakeCatalog,
  latestCatalogImport,
  retryCatalogParsing,
  selectCatalogRecords,
} from "@/lib/product/catalog-import-store";
import { productCatalogImportWorkflow } from "@/workflows/product-catalog-import";

async function identity(projectId: string): Promise<CatalogIdentity> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "product:write"))
    throw new Error("需要产品编辑权限。");
  return { actorId: session.user.id, sessionId: session.session.id, projectId };
}

async function dispatch(work: CatalogDispatch, actor: CatalogIdentity) {
  if (work.attemptIds.length) {
    try {
      const run = await start(productCatalogImportWorkflow, [work.attemptIds]);
      await attachCatalogWorkflow(work.attemptIds, run.runId);
    } catch {
      await Promise.all(work.attemptIds.map((id) => failCatalogAttempt(id, "DISPATCH_FAILED")));
    }
  }
  return catalogImportView({ projectId: actor.projectId, importId: work.importId }, actor);
}

export async function intakeProductCatalogAction(input: unknown): Promise<CatalogActionResult> {
  try {
    const value = catalogIntakeSchema.parse(input);
    const actor = await identity(value.projectId);
    return { status: "success", view: await dispatch(await intakeCatalog(value, actor), actor) };
  } catch {
    return { status: "error", message: "无法创建目录任务，请确认项目权限及上传回执仍有效。" };
  }
}

export async function retryProductCatalogAction(input: unknown): Promise<CatalogActionResult> {
  try {
    const value = catalogLookupSchema.parse(input);
    const actor = await identity(value.projectId);
    return {
      status: "success",
      view: await dispatch(await retryCatalogParsing(value, actor), actor),
    };
  } catch {
    return { status: "error", message: "无法重试目录解析，请确认任务归属及项目权限。" };
  }
}

export async function selectProductCatalogAction(input: unknown): Promise<CatalogActionResult> {
  try {
    const value = catalogSelectionSchema.parse(input);
    const actor = await identity(value.projectId);
    await resolveProductAgentModelConfig(value.modelConfigId, value.model);
    return {
      status: "success",
      view: await dispatch(await selectCatalogRecords(value, actor), actor),
    };
  } catch {
    return {
      status: "error",
      message: "无法提交候选，请确认选中 1–20 条记录、模型配置及项目权限。",
    };
  }
}

export async function getProductCatalogAction(input: unknown): Promise<CatalogActionResult> {
  try {
    const value = catalogLookupSchema.parse(input);
    return {
      status: "success",
      view: await catalogImportView(value, await identity(value.projectId)),
    };
  } catch {
    return { status: "error", message: "无法读取目录进度，请确认登录状态及项目权限。" };
  }
}

export async function getLatestProductCatalogAction(
  projectId: string,
): Promise<
  { status: "success"; view: CatalogImportView | null } | { status: "error"; message: string }
> {
  try {
    const id = z.uuid().parse(projectId);
    return { status: "success", view: await latestCatalogImport(id, await identity(id)) };
  } catch {
    return { status: "error", message: "无法恢复目录任务，请确认登录状态及项目权限。" };
  }
}
