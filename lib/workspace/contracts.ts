
import { z } from "zod";

export const workspaceProjectKindSchema = z.enum(["marketing", "sales"]);
export const workspaceProjectStatusSchema = z.enum(["active", "archived"]);

export const createWorkspaceProjectSchema = z.object({
  kind: workspaceProjectKindSchema,
  title: z.string().trim().min(1, "请输入项目名称。").max(120, "项目名称不能超过 120 个字符。"),
}).strict();
