import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createProductAgentModel } from "@/lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import { auth } from "@/lib/auth";
import { productAgentRunFormSchema } from "@/lib/form-schemas";
import {
  PRODUCT_STREAM_PROMPT_HASH,
  PRODUCT_STREAM_PROMPT_VERSION,
  streamProductProposals,
} from "@/lib/product/stream-model";
import { productStreamResponse, readProductStreamForm } from "@/lib/product/stream-response";
import { runProductStream } from "@/lib/product/stream-runner";
import {
  finishProductStreamRun,
  persistProductStreamDraft,
  startProductStreamRun,
} from "@/lib/product/stream-store";
import { prepareUploadedProductAgentDocument } from "@/lib/product/uploaded-document";
import { assertWorkspaceProjectKind } from "@/lib/workspace/store";

export const maxDuration = 120;

export async function POST(request: Request) {
  // This cookie-authenticated mutation must originate from the app itself.
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "请求来源无效。" }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (session?.user.role !== "admin")
    return Response.json({ error: "仅管理员可运行流式产品导入。" }, { status: 403 });
  try {
    const data = await readProductStreamForm(request);
    const uploaded = data.get("document");
    const parsed = productAgentRunFormSchema.parse({
      ...Object.fromEntries(data),
      hasUpload: uploaded instanceof File && uploaded.size > 0,
    });
    const projectId = z.uuid("项目标识无效。").parse(data.get("projectId"));
    await assertWorkspaceProjectKind(projectId, "marketing", session.user.id);
    const config = await resolveProductAgentModelConfig(parsed.modelConfigId, parsed.model);
    const model = createProductAgentModel(config);
    const source =
      uploaded instanceof File && uploaded.size > 0
        ? (await prepareUploadedProductAgentDocument(uploaded, session.user.id)).source
        : {
            record_id: randomUUID(),
            source_ref: z.string().min(1).parse(parsed.sourceRef),
            evidence_refs: [z.string().min(1).parse(parsed.evidenceRef)],
            source_text: parsed.sourceText,
            image_availability: "none" as const,
            image_refs: [],
          };
    request.signal.throwIfAborted();
    const identity = { actorId: session.user.id, sessionId: session.session.id, projectId };
    const run = await startProductStreamRun(identity, source, {
      config_id: parsed.modelConfigId,
      provider: config.provider,
      model: config.model,
      prompt_version: PRODUCT_STREAM_PROMPT_VERSION,
      prompt_hash: PRODUCT_STREAM_PROMPT_HASH,
    });
    const controller = new AbortController();
    const signal = AbortSignal.any([
      request.signal,
      controller.signal,
      AbortSignal.timeout(90_000),
    ]);
    const refresh = () => {
      revalidatePath(`/workspace/${projectId}`);
    };
    const events = runProductStream({
      runId: run.runId,
      source,
      signal,
      proposals: (located) => streamProductProposals({ model, source: located, signal }),
      persist: async (draft) => {
        const saved = await persistProductStreamDraft(identity, run.runId, draft);
        refresh();
        return saved;
      },
      finish: async (status) => {
        await finishProductStreamRun(identity, run.runId, status);
        refresh();
      },
    });
    return productStreamResponse(events, controller, async () => {
      await finishProductStreamRun(identity, run.runId, "interrupted");
      refresh();
    });
  } catch {
    return Response.json(
      { error: "无法开始生成，请检查项目权限、证据和模型配置。" },
      { status: 400 },
    );
  }
}
