import type { LeadEntry } from "./closing-store";

/** Summarize authorized customer messages for selection, without inferring customer identity. */
export function leadChoiceLabel(lead: Pick<LeadEntry, "id" | "timeline">) {
  const latest = lead.timeline
    .filter(
      (message) =>
        message.direction === "inbound" &&
        message.deliveryStatus === "received" &&
        message.body.trim(),
    )
    .reduce<LeadEntry["timeline"][number] | undefined>(
      (current, message) =>
        !current || message.receivedAt.getTime() > current.receivedAt.getTime() ? message : current,
      undefined,
    );
  const characters = Array.from(latest?.body.replace(/\s+/g, " ").trim() ?? "");
  const excerpt = characters.length
    ? `客户消息：${characters.slice(0, 80).join("")}${characters.length > 80 ? "…" : ""}`
    : "暂无可显示的客户消息";
  return `${excerpt} · 会话 ${lead.id.slice(0, 8)}…${lead.id.slice(-8)}`;
}
