import type { ProductAgentSource } from "./agent";
import { prepareProductAgentEvidenceSource } from "./evidence-locations";
import {
  type ProductStreamEvent,
  productStreamEventSchema,
  productStreamFields,
} from "./stream-contract";
import { emptyProductStreamDraft, validateProductStreamProposal } from "./stream-validation";
import type { ProductDraft } from "./verification";

type EventBody = ProductStreamEvent extends infer Event
  ? Event extends ProductStreamEvent
    ? Omit<Event, "protocol" | "runId" | "sequence">
    : never
  : never;

export interface ProductStreamRunDependencies {
  runId: string;
  source: ProductAgentSource;
  signal: AbortSignal;
  proposals: (
    source: ReturnType<typeof prepareProductAgentEvidenceSource<ProductAgentSource>>,
  ) => AsyncIterable<unknown>;
  // Implementations must independently reauthorize and lock the run/aggregate on each write.
  persist: (draft: ProductDraft) => Promise<{ productId: string; version: number }>;
  finish: (status: "completed" | "failed" | "interrupted") => Promise<void>;
}

/** The client sees a validated field only after its transaction commits. */
export async function* runProductStream(
  dependencies: ProductStreamRunDependencies,
): AsyncGenerator<ProductStreamEvent> {
  let sequence = 0;
  const event = (body: EventBody) =>
    productStreamEventSchema.parse({
      protocol: "product-agent.v1",
      runId: dependencies.runId,
      sequence: ++sequence,
      ...body,
    });
  let finished = false;
  try {
    dependencies.signal.throwIfAborted();
    yield event({ type: "stage", stage: "preparing" });
    const source = prepareProductAgentEvidenceSource(dependencies.source);
    let draft = emptyProductStreamDraft(source);
    for (const field of productStreamFields)
      yield event({ type: "field", field, status: "waiting", value: null, evidenceRef: null });
    yield event({ type: "stage", stage: "generating" });
    let count = 0;
    let acceptedCount = 0;
    const seen = new Set<string>();
    for await (const proposal of dependencies.proposals(source)) {
      dependencies.signal.throwIfAborted();
      if (++count > 100) throw new Error("Product stream exceeded its field limit");
      const checked = validateProductStreamProposal(draft, proposal, source);
      seen.add(checked.proposal.field);
      if (checked.status === "source_validated") {
        const saved = await dependencies.persist(checked.draft);
        draft = checked.draft;
        acceptedCount++;
        yield event({ type: "draft", ...saved });
      }
      yield event({ type: "field", ...checked.proposal, status: checked.status });
    }
    dependencies.signal.throwIfAborted();
    for (const field of productStreamFields) {
      if (!seen.has(field))
        yield event({
          type: "field",
          field,
          status: "needs_evidence",
          value: null,
          evidenceRef: null,
        });
    }
    if (acceptedCount === 0) {
      await dependencies.finish("failed");
      finished = true;
      yield event({
        type: "error",
        code: "no_accepted_fields",
        message:
          "未提取到可由来源验证的字段，本次导入未成功。请检查资料内容、表头和字段证据后重试。CSV 可使用：Product name、Product type、Internal SKU、OE、Application、Vehicle brand、Vehicle model；不支持 product_name 等下划线表头。空草稿保留用于核查，不能用于发布或报价。",
      });
      yield event({ type: "stage", stage: "failed" });
      return;
    }
    await dependencies.finish("completed");
    finished = true;
    yield event({ type: "stage", stage: "completed" });
  } catch {
    const status = dependencies.signal.aborted ? "interrupted" : "failed";
    await dependencies.finish(status);
    finished = true;
    yield event({
      type: "error",
      code: status === "failed" ? "run_failed" : "interrupted",
      message: "生成已停止；已保存的字段仍需人工审核。",
    });
    yield event({ type: "stage", stage: status });
  } finally {
    // Explicit iterator cancellation (e.g. response body disconnect) must also settle the run.
    if (!finished) await dependencies.finish("interrupted");
  }
}
