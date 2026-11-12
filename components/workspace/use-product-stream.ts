"use client";

import { useEffect, useRef, useState } from "react";
import type { ProductAgentActionState } from "@/lib/actions/product-agent";
import {
  PRODUCT_INTAKE_ERROR_HEADER,
  productIntakeErrorMessage,
} from "@/lib/product/intake-errors";
import { consumeProductStream, ProductStreamError } from "@/lib/product/stream-client";
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
      if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => {});
        throw new ProductStreamError(
          productIntakeErrorMessage(response.headers.get(PRODUCT_INTAKE_ERROR_HEADER)),
        );
      }
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
                  : event.stage === "failed" || event.stage === "interrupted"
                    ? previous.status === "error" && previous.message
                      ? previous.message
                      : event.stage === "interrupted"
                        ? "生成已中断，已保存字段仍可在草稿中查看。"
                        : "生成未完成，请核对资料；若已有草稿，可先查看已保存字段。"
                    : previous.message,
          }));
      });
    } catch (error) {
      setState((previous) => ({
        ...previous,
        status: "error",
        message: active.signal.aborted
          ? "生成已停止，已保存字段仍可在草稿中查看。"
          : error instanceof ProductStreamError
            ? error.message
            : "生成连接未能完成，请检查网络；若已有草稿，可先查看已保存字段。",
      }));
    } finally {
      controller.current = null;
      setPending(false);
    }
  }
  return { start, stop: () => controller.current?.abort(), pending, state, fields };
}
