"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  type WorkspaceRecordKind,
  workspaceRecordHref,
  workspaceReturnTo,
} from "@/lib/workspace/navigation";

// Single-record creation opens its result once. Revisions stay in place; batch imports use their result list.
export function useCreatedRecord(
  projectId: string,
  kind: WorkspaceRecordKind,
  status: string,
  id: string | undefined,
  enabled = true,
) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = workspaceReturnTo(searchParams.get("returnTo"));
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || status !== "success" || !id || opened.current === id) return;
    opened.current = id;
    router.replace(workspaceRecordHref(projectId, kind, id, returnTo));
  }, [enabled, id, kind, projectId, returnTo, router, status]);
}
