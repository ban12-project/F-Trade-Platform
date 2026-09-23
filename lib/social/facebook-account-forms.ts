import { z } from "zod";

const secret = z.string().max(4096); // Never trim a password.
export function normalizeFacebookTotpSecret(value: string) {
  return value.replace(/ /g, "").replace(/=+$/, "").toUpperCase();
}
function validBase32(value: string) {
  const normalized = normalizeFacebookTotpSecret(value);
  if (!/^[A-Z2-7]{16,128}$/.test(normalized)) return false;
  const remainder = normalized.length % 8;
  if (![0, 2, 4, 5, 7].includes(remainder)) return false;
  const last = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(normalized.at(-1)!);
  return (last & ((1 << ((normalized.length * 5) % 8)) - 1)) === 0;
}
export const facebookCredentialFormSchema = z
  .object({
    loginUsername: z.string().trim().max(320),
    loginPassword: secret,
    totpSecret: z
      .string()
      .max(256)
      .regex(/^$|^[A-Za-z2-7 =]+$/, "请填写 Base32 密钥。")
      .refine((value) => value === "" || validBase32(value), "请填写完整、有效的 Base32 密钥。")
      .optional(),
    messengerPin: z
      .string()
      .regex(/^$|^[0-9]{6}$/, "PIN 必须是 6 位数字。")
      .optional(),
    clearTotp: z.boolean().optional(),
    clearPin: z.boolean().optional(),
    proxyHost: z.string().trim().max(253),
    proxyPort: z.string().regex(/^$|^[0-9]{1,5}$/),
    proxyUsername: z.string().max(512),
    proxyPassword: secret,
    clearLogin: z.boolean(),
    clearProxy: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!!v.loginUsername !== !!v.loginPassword)
      ctx.addIssue({
        code: "custom",
        path: ["loginPassword"],
        message: "更新登录凭据时，请同时填写账号和密码。",
      });
    const proxyChanged = !!(v.proxyHost || v.proxyPort || v.proxyUsername || v.proxyPassword);
    if (
      proxyChanged &&
      (!v.proxyHost ||
        !v.proxyPort ||
        Number(v.proxyPort) < 1 ||
        Number(v.proxyPort) > 65535 ||
        !/^[A-Za-z0-9.-]+$/.test(v.proxyHost))
    )
      ctx.addIssue({
        code: "custom",
        path: ["proxyHost"],
        message: "填写固定代理主机和有效端口，不接受 URL。",
      });
    if (!!v.proxyUsername !== !!v.proxyPassword)
      ctx.addIssue({
        code: "custom",
        path: ["proxyPassword"],
        message: "代理用户名和密码必须同时填写。",
      });
    if (
      (v.clearLogin && !!(v.loginPassword || v.totpSecret || v.messengerPin)) ||
      (v.clearTotp && !!v.totpSecret) ||
      (v.clearPin && !!v.messengerPin) ||
      (v.clearProxy && proxyChanged)
    )
      ctx.addIssue({ code: "custom", message: "清除凭据和更新凭据不能同时进行。" });
  });
export const facebookLoginSecretSchema = z
  .object({
    username: z.string().min(1).max(320),
    password: z.string().min(1).max(4096),
    totpSecret: z
      .string()
      .regex(/^[A-Z2-7]{16,128}$/)
      .refine(validBase32)
      .optional(),
    messengerPin: z
      .string()
      .regex(/^[0-9]{6}$/)
      .optional(),
  })
  .strict();
export const facebookProxySecretSchema = z
  .object({
    host: z
      .string()
      .regex(/^[A-Za-z0-9.-]+$/)
      .max(253),
    port: z.number().int().min(1).max(65535),
    username: z.string().max(512),
    password: z.string().max(4096),
  })
  .strict();
export const facebookConnectFormSchema = z.object({ useSavedLogin: z.boolean() }).strict();
export const facebookMediaSubmitFormSchema = z
  .object({
    projectId: z.uuid(),
    contentRef: z.uuid(),
    format: z.enum(["image", "video"]),
    mediaId: z.string().max(200),
    confirm: z.literal(true),
  })
  .strict();
