import { z } from "zod";

export const librarySearchSchema = z.object({
  q: z.string().trim().max(200, "搜索内容不能超过 200 个字符"),
});

export function parseLibrarySearch(value: unknown) {
  const result = librarySearchSchema.safeParse({ q: value ?? "" });
  return result.success
    ? { q: result.data.q, error: undefined }
    : {
        q: "",
        error:
          typeof value === "string"
            ? "搜索内容不能超过 200 个字符"
            : "搜索链接格式无效，请重新输入关键词。",
      };
}
