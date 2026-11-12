import { z } from "zod";

export const librarySearchSchema = z.object({
  q: z.string().trim().max(200, "搜索内容不能超过 200 个字符"),
});

export function parseLibrarySearch(value: unknown) {
  const result = librarySearchSchema.safeParse({ q: value ?? "" });
  return result.success ? result.data.q : "";
}
