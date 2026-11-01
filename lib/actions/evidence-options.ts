"use server";

import { z } from "zod";
import { authorizedActionSession } from "@/lib/action-boundary";
import { listProjectEvidenceOptions } from "@/lib/workspace/access";
import { assertWorkspaceAggregateLink } from "@/lib/workspace/store";

const requestSchema = z.object({ projectId: z.uuid(), videoId: z.uuid().optional() }).strict();

/** Readable choices only; business actions still authorize and validate every write. */
export async function listEvidenceOptionsAction(input: unknown) {
  const session = await authorizedActionSession("workspace:view");
  const parsed = requestSchema.safeParse(input);
  if (!session || !parsed.success) return { options: [], error: "请重新登录并确认项目权限。" };
  try {
    if (parsed.data.videoId)
      await assertWorkspaceAggregateLink(
        parsed.data.projectId,
        parsed.data.videoId,
        "marketing",
        "video",
        session.user.id,
      );
    const options = await listProjectEvidenceOptions(
      parsed.data.projectId,
      session.user.id,
      undefined,
      parsed.data.videoId,
    );
    return {
      options: options.map(({ id, sourceLabel, contentType, createdAt }) => ({
        id,
        label: sourceLabel,
        detail: `${contentType} · ${createdAt.toISOString().slice(0, 10)}`,
      })),
      error: "",
    };
  } catch {
    return { options: [], error: "无法读取资料，请确认项目权限后重试。" };
  }
}
