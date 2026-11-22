import "server-only";

import { getSavedProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import { browserAgentDecision } from "@/lib/browser-agent/model";
import type { InboxAgentContext, InboxAgentSnapshot } from "./inbox-agent-schema";

export const INBOX_AGENT_TASK =
  "Inspect all visible Messenger threads read-only using only the supplied capability handles. Navigate to each unvisited thread-* handle in remainingHandles to observe messages. Once remainingHandles is empty and finalListRechecked is false, navigate to inbox-home to recheck the visible thread list. Once remainingHandles is empty and finalListRechecked is true, emit finish immediately. Never click, type, upload, reply, or invent targets.";

export async function decideInboxBrowserAction(
  input: { snapshot: InboxAgentSnapshot; context: InboxAgentContext },
  signal: AbortSignal,
) {
  const config = await getSavedProductAgentModelConfig();
  if (!config) throw new Error("inbox_agent_model_unconfigured");
  const decision = await browserAgentDecision(config, INBOX_AGENT_TASK)(
    input.snapshot,
    signal,
    input.context,
  );
  return {
    command: decision.command,
    modelId: decision.modelId ?? null,
    inputTokens: decision.inputTokens ?? null,
    outputTokens: decision.outputTokens ?? null,
  };
}
