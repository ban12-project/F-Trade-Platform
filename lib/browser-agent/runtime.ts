import { createHash } from "node:crypto";
import { z } from "zod";

export const commandSchema = z
  .object({
    action: z.enum(["read", "navigate", "click", "input", "scroll", "upload", "finish"]),
    target: z.string().max(80),
    valueRef: z.string().max(80),
  })
  .strict();
export type Command = z.infer<typeof commandSchema>;
export type Snapshot = {
  controls: Array<{ id: string; label: string; actions: string[] }>;
  state: string;
};
export type Decision = {
  command: unknown;
  inputTokens?: number;
  outputTokens?: number;
  modelId?: string;
};
export type DecisionContext = {
  remainingCalls: number;
  unchangedObservations: number;
  recentActions: Array<{ action: Command["action"]; changed: boolean }>;
};
export type Decide = (
  snapshot: Snapshot,
  signal: AbortSignal,
  context?: DecisionContext,
) => Promise<Decision>;
export type Capability = {
  action: Exclude<Command["action"], "read" | "finish">;
  target: string;
  valueRefs: readonly string[];
  execute(valueRef: string, signal: AbortSignal): Promise<void>;
};
export type Port = {
  observe(signal: AbortSignal): Promise<Snapshot>;
  verify(signal: AbortSignal): Promise<boolean>;
  capabilities: readonly Capability[];
};
export type AgentResult = {
  outcome: "completed" | "stopped";
  reason:
    | "verified"
    | "limit"
    | "no_progress"
    | "cancelled"
    | "invalid_action"
    | "unverified"
    | "execution_failed";
  calls: number;
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
  usageComplete: boolean;
  modelIds: string[];
  trace: Array<{ action: Command["action"]; stateHash: string }>;
};

// This function races every I/O and propagates cancellation. Ports must also obey
// the signal before effects; a Promise race alone cannot cancel a remote mutation.
async function bounded<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let listener: () => void = () => {};
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        listener = () => reject(new Error("cancelled"));
        signal.addEventListener("abort", listener, { once: true });
        if (signal.aborted) listener();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}
export async function runBrowserAgent(options: {
  port: Port;
  decide: Decide;
  signal: AbortSignal;
  maxCalls?: number;
  timeoutMs?: number;
}): Promise<AgentResult> {
  const start = Date.now();
  const timeout = options.timeoutMs ?? 300_000;
  const maximum = options.maxCalls ?? 40;
  if (
    !Number.isInteger(maximum) ||
    maximum < 1 ||
    maximum > 40 ||
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > 300_000
  )
    throw new Error("invalid_agent_limits");
  const timer = AbortSignal.timeout(timeout);
  const signal = AbortSignal.any([options.signal, timer]);
  const result: AgentResult = {
    outcome: "stopped",
    reason: "limit",
    calls: 0,
    elapsedMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    usageComplete: true,
    modelIds: [],
    trace: [],
  };
  const hash = (snapshot: Snapshot) =>
    createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  try {
    let snapshot = await bounded(() => options.port.observe(signal), signal);
    let unchanged = 0;
    const recentActions: DecisionContext["recentActions"] = [];
    while (result.calls < maximum) {
      signal.throwIfAborted();
      result.calls++;
      const decision = await bounded(
        () =>
          options.decide(snapshot, signal, {
            remainingCalls: maximum - result.calls,
            unchangedObservations: unchanged,
            recentActions: recentActions.map((entry) => ({ ...entry })),
          }),
        signal,
      );
      result.inputTokens += decision.inputTokens ?? 0;
      result.outputTokens += decision.outputTokens ?? 0;
      result.usageComplete &&=
        decision.inputTokens !== undefined && decision.outputTokens !== undefined;
      if (decision.modelId && !result.modelIds.includes(decision.modelId))
        result.modelIds.push(decision.modelId);
      const parsed = commandSchema.safeParse(decision.command);
      if (!parsed.success) {
        result.reason = "invalid_action";
        break;
      }
      const command = parsed.data;
      result.trace.push({ action: command.action, stateHash: hash(snapshot) });
      if (command.action === "finish") {
        const verified = await bounded(() => options.port.verify(signal), signal);
        result.reason = verified ? "verified" : "unverified";
        result.outcome = verified ? "completed" : "stopped";
        break;
      }
      if (command.action !== "read") {
        // Only host-issued capability handles are accepted. No model selectors,
        // arbitrary URLs, input strings, file paths, or publish capability.
        const capability = options.port.capabilities.find(
          (c) =>
            c.action === command.action &&
            c.target === command.target &&
            c.valueRefs.includes(command.valueRef),
        );
        if (!capability) {
          result.reason = "invalid_action";
          break;
        }
        await bounded(() => capability.execute(command.valueRef, signal), signal);
      }
      const next = await bounded(() => options.port.observe(signal), signal);
      const changed = hash(next) !== hash(snapshot);
      recentActions.push({ action: command.action, changed });
      if (recentActions.length > 6) recentActions.shift();
      unchanged = changed ? 0 : unchanged + 1;
      snapshot = next;
      if (unchanged >= 3) {
        result.reason = "no_progress";
        break;
      }
    }
  } catch {
    result.reason = signal.aborted ? "cancelled" : "execution_failed";
  } finally {
    result.elapsedMs = Date.now() - start;
  }
  return result;
}
