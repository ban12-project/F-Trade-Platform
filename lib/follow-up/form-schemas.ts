import { z } from "zod";
import { privateReference } from "@/lib/evidence/form-reference";
import { followUpContexts } from "@/lib/follow-up/cadence";
import { scoringRules } from "@/lib/follow-up/lead-scoring";

export const followUpFormSchema = z
  .object({
    projectId: z.uuid("项目标识无效。"),
    leadId: z.uuid("线索标识无效。"),
    context: z.enum(followUpContexts),
    triggeredRules: z.array(z.enum(scoringRules.map((rule) => rule.id))).max(scoringRules.length),
    draft: z.string().trim().min(1, "请填写人工确认后的跟进内容。").max(4_000),
    confirmationRef: privateReference,
    nextFollowUpAt: z.string().trim().optional().or(z.literal("")),
  })
  .superRefine((value, context) => {
    if (value.nextFollowUpAt && Number.isNaN(Date.parse(value.nextFollowUpAt)))
      context.addIssue({ code: "custom", path: ["nextFollowUpAt"], message: "下次跟进时间无效。" });
  });

/** Internal planning has no outbound-message or approval fields. Times include an explicit offset. */

export const followUpPlanFormSchema = z.object({
  projectId: followUpFormSchema.shape.projectId,
  leadId: followUpFormSchema.shape.leadId,
  context: followUpFormSchema.shape.context,
  triggeredRules: followUpFormSchema.shape.triggeredRules,
  nextFollowUpAt: z.union([z.iso.datetime({ offset: true }), z.literal("")]),
});
