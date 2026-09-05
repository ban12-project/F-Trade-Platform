"use client";

import { useEffect, useRef, useState } from "react";
import type { ProductAgentActionState } from "@/lib/actions/product-agent";
import { consumeProductStream } from "@/lib/product/stream-client";
import type { ProductStreamEvent } from "@/lib/product/stream-contract";

type FieldEvent = Extract<ProductStreamEvent, { type: "field" }>;
export function useProductStream() {
  const controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<ProductAgentActionState>({ status: "idle", message: "" });
  const [fields, setFields] = useState<Record<string, FieldEvent>>({});
  useEffect(() => () => controller.current?.abort(), []);
  async function start(data: FormData) {
    if (controller.current) return;
    const active = new AbortController();
    controller.current = active;
    setPending(true);
    setFields({});
    setState({ status: "idle", message: "正在准备资料…" });
    try {
      const response = await fetch("/api/product-agent/stream", {
        method: "POST",
        body: data,
        signal: active.signal,
      });
      if (!response.ok || !response.body)
        throw new Error("无法开始生成，请检查管理员权限、证据和模型配置。");
      await consumeProductStream(response.body, (event) => {
        if (event.type === "draft")
          setState((previous) => ({ ...previous, productId: event.productId }));
        if (event.type === "field")
          setFields((previous) =>
            previous[event.field]?.status === "source_validated"
              ? previous
              : { ...previous, [event.field]: event },
          );
        if (event.type === "error")
          setState((previous) => ({ ...previous, status: "error", message: event.message }));
        if (event.type === "stage")
          setState((previous) => ({
            ...previous,
            status:
              event.stage === "completed"
                ? "success"
                : ["failed", "interrupted"].includes(event.stage)
                  ? "error"
                  : "idle",
            message:
              event.stage === "completed"
                ? "生成已完成，已保存字段仍需人工审核。"
                : event.stage === "generating"
                  ? "正在逐字段核对来源并保存…"
                  : previous.message,
          }));
      });
    } catch (error) {
      setState((previous) => ({
        ...previous,
        status: "error",
        message: active.signal.aborted
          ? "生成已停止，已保存字段仍可在草稿中查看。"
          : error instanceof Error
            ? error.message
            : "生成失败。",
      }));
    } finally {
      controller.current = null;
      setPending(false);
    }
  }
  return { start, stop: () => controller.current?.abort(), pending, state, fields };
}
