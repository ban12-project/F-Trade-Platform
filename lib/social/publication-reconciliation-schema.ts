import { z } from "zod";

export const publicationReconciliationSchema = z
  .object({
    projectId: z.uuid(),
    publicationId: z.uuid(),
    externalPublicationRef: z
      .url("请填写有效的帖子链接。")
      .max(160)
      .refine((value) => {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          return false;
        }
        return (
          url.origin === "https://www.facebook.com" &&
          !url.username &&
          !url.password &&
          !url.hash &&
          ((/^\/[^/]+\/posts\/[^/]+$/.test(url.pathname) && !url.search) ||
            (url.pathname === "/permalink.php" &&
              !!url.searchParams.get("story_fbid") &&
              !!url.searchParams.get("id") &&
              [...url.searchParams.keys()].length === 2))
        );
      }, "请填写 Facebook 帖子的正式链接，移除跟踪参数。"),
    evidenceRef: z
      .string()
      .trim()
      .regex(/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i, "请填写 evidence- 开头的私有核对依据编号。"),
    confirmed: z.boolean().refine((value) => value, "请先核对账号、完整文案、受众和帖子链接。"),
  })
  .strict();
