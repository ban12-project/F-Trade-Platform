import { z } from "zod";

export const emailSchema = z.string().trim().min(1, "请输入邮箱地址。").email("请输入有效的邮箱地址。");

export const invitationFormSchema = z.object({
  email: emailSchema,
});

export const authFormSchema = z.object({
  email: emailSchema,
  otp: z.string().trim().min(1, "请输入邮箱验证码。"),
});
