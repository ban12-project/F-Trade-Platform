import type { PublicationDriver } from "../../ops/browser-node/publication-executor.mjs";
import { type AgentResult, type Decide, type Port, runBrowserAgent } from "./runtime";

/** Isolated opt-in adapter. The trusted driver retains every evidence and effect
 * boundary. Its prepare is the only replaced method; the node default is untouched. */
export function selectPublicationDriver<Session>(options: {
  mode?: "legacy" | "agent";
  trusted: PublicationDriver<Session>;
  decide: Decide;
  signal: AbortSignal;
  port: (
    session: Session,
    payload: Parameters<PublicationDriver<Session>["prepare"]>[1],
    upload: Parameters<PublicationDriver<Session>["prepare"]>[2],
  ) => Port;
  record: (result: AgentResult) => void;
}): PublicationDriver<Session> {
  if ((options.mode ?? "legacy") === "legacy") return options.trusted;
  return {
    ...options.trusted,
    async prepare(session, payload, upload) {
      const result = await runBrowserAgent({
        port: options.port(session, payload, upload),
        decide: options.decide,
        signal: options.signal,
      });
      options.record(result);
      if (result.outcome !== "completed") throw new Error("agent_preparation_unverified");
    },
  };
}
