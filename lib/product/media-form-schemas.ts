import { z } from "zod";

import {
  registerProductMediaInputSchema,
  reviewProductMediaInputSchema,
  type RegisterProductMediaInput,
  type ReviewProductMediaInput,
} from "./media-service";
import { productMediaRoleSchema } from "./video-readiness";

const evidenceReferenceSchema = z.string().trim().regex(
  /^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i,
  "必须引用私有证据记录。",
);

export const productMediaRegistrationFormSchema = z.object({
  projectId: z.uuid("项目标识无效。"),
  productId: z.uuid("产品标识无效。"),
  evidenceRef: evidenceReferenceSchema,
  origin: z.enum(["factory", "user_upload", "licensed"]),
  role: productMediaRoleSchema,
  description: z.string().trim().max(500, "素材说明不能超过 500 个字符。"),
  tags: z.string().trim().max(500, "素材标签不能超过 500 个字符。"),
  productVisible: z.boolean(),
  logoVisible: z.boolean(),
  textPresent: z.boolean(),
  rightsEvidenceRef: evidenceReferenceSchema,
  editingAllowed: z.boolean(),
  publicDistributionAllowed: z.boolean(),
  paidAdvertisingAllowed: z.boolean(),
  imageToVideoAllowed: z.boolean(),
  referenceToVideoAllowed: z.boolean(),
  rightsExpiresAt: z.string().trim().max(64, "授权到期时间格式不正确。"),
}).strict().superRefine((value, context) => {
  if ((value.imageToVideoAllowed || value.referenceToVideoAllowed) && !value.editingAllowed) {
    context.addIssue({ code: "custom", path: ["editingAllowed"], message: "生成式使用必须同时取得编辑授权。" });
  }
  if (value.rightsExpiresAt && Number.isNaN(Date.parse(value.rightsExpiresAt))) {
    context.addIssue({ code: "custom", path: ["rightsExpiresAt"], message: "授权到期时间无效。" });
  }
});

export const productMediaReviewFormSchema = z.object({
  projectId: z.uuid("项目标识无效。"),
  productId: z.uuid("产品标识无效。"),
  assetId: z.uuid("素材标识无效。"),
  decision: z.enum(["approved", "rejected"]),
  evidenceRef: evidenceReferenceSchema,
  notes: z.string().trim().max(1_000, "审核备注不能超过 1000 个字符。"),
}).strict();

export type ProductMediaRegistrationForm = z.infer<typeof productMediaRegistrationFormSchema>;
export type ProductMediaReviewForm = z.infer<typeof productMediaReviewFormSchema>;

function booleanValue(value: FormDataEntryValue | undefined) {
  return value === "true" || value === "1" || value === "on";
}

function textValue(value: FormDataEntryValue | undefined) {
  return typeof value === "string" ? value : "";
}

function tags(value: string) {
  return [...new Set(value.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean))].slice(0, 20);
}

export function parseProductMediaRegistrationFormData(formData: FormData): {
  projectId: string;
  input: RegisterProductMediaInput;
} {
  const values = Object.fromEntries(formData);
  const parsed = productMediaRegistrationFormSchema.parse({
    projectId: textValue(values.projectId),
    productId: textValue(values.productId),
    evidenceRef: textValue(values.evidenceRef),
    origin: textValue(values.origin),
    role: textValue(values.role),
    description: textValue(values.description),
    tags: textValue(values.tags),
    productVisible: booleanValue(values.productVisible),
    logoVisible: booleanValue(values.logoVisible),
    textPresent: booleanValue(values.textPresent),
    rightsEvidenceRef: textValue(values.rightsEvidenceRef),
    editingAllowed: booleanValue(values.editingAllowed),
    publicDistributionAllowed: booleanValue(values.publicDistributionAllowed),
    paidAdvertisingAllowed: booleanValue(values.paidAdvertisingAllowed),
    imageToVideoAllowed: booleanValue(values.imageToVideoAllowed),
    referenceToVideoAllowed: booleanValue(values.referenceToVideoAllowed),
    rightsExpiresAt: textValue(values.rightsExpiresAt),
  });
  const input = registerProductMediaInputSchema.parse({
    productId: parsed.productId,
    evidenceRef: parsed.evidenceRef,
    origin: parsed.origin,
    semantic: {
      role: parsed.role,
      description: parsed.description,
      tags: tags(parsed.tags),
      productVisible: parsed.productVisible,
      logoVisible: parsed.logoVisible,
      textPresent: parsed.textPresent,
    },
    rights: {
      rightsEvidenceRef: parsed.rightsEvidenceRef,
      editingAllowed: parsed.editingAllowed,
      publicDistributionAllowed: parsed.publicDistributionAllowed,
      paidAdvertisingAllowed: parsed.paidAdvertisingAllowed,
      imageToVideoAllowed: parsed.imageToVideoAllowed,
      referenceToVideoAllowed: parsed.referenceToVideoAllowed,
      expiresAt: parsed.rightsExpiresAt ? new Date(parsed.rightsExpiresAt).toISOString() : null,
    },
  });
  return { projectId: parsed.projectId, input };
}

export function parseProductMediaReviewFormData(formData: FormData): {
  projectId: string;
  productId: string;
  input: ReviewProductMediaInput;
} {
  const parsed = productMediaReviewFormSchema.parse(Object.fromEntries(formData));
  return {
    projectId: parsed.projectId,
    productId: parsed.productId,
    input: reviewProductMediaInputSchema.parse({
      assetId: parsed.assetId,
      decision: parsed.decision,
      evidenceRef: parsed.evidenceRef,
      notes: parsed.notes,
    }),
  };
}
