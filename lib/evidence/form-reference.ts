import { z } from "zod";

export const privateReference = z
  .string()
  .trim()
  .regex(/^(?:source|evidence)-[a-z0-9][a-z0-9_-]{2,120}$/i, "请选择来源资料。");
