"use server";

import { authorizedActionSession } from "@/lib/action-boundary";
import { inboundContextRequestSchema } from "@/lib/form-schemas";
import { SocialHumanAccessError } from "@/lib/social/human-write-access";
import { type InboundContextPreview, readInboundContext } from "@/lib/social/inbound-context-store";

export async function readInboundContextAction(
  input: unknown,
): Promise<{ preview: InboundContextPreview; error?: never } | { error: string; preview?: never }> {
  try {
    const current = await authorizedActionSession("sales:write");
    const parsed = inboundContextRequestSchema.safeParse(input);
    if (!current || !parsed.success) throw new SocialHumanAccessError();
    const preview = await readInboundContext(parsed.data, {
      actorId: current.user.id,
      sessionId: current.session.id,
    });
    return { preview };
  } catch {
    // Do not expose account identities, existence, ciphertext or decryption failures.
    return { error: "无法查看上下文。请确认当前登录及入站账号负责人权限，或刷新已分流的消息。" };
  }
}
